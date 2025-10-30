const { createClient, ClientStatus } = require('bedrock-protocol');
const minecraftData = require('minecraft-data');
const { logger, sleep, parseMinecraftColors } = require('./utils.js');
const { atmQueue, isShuttingDown, ATM_OPERATION_TIMEOUT } = require('./atm.js');
const { homeQueue, HOME_OPERATION_TIMEOUT } = require('./home.js');

// 載入一份PC版的語言檔案，用於將物品的英文程式名稱翻譯成中文
const mcLang = minecraftData('bedrock_1.21.111').language;

class Bot {
    constructor(botConfig, itemMapping) {
        this.config = {
            offline: true, profilePath: './profiles', version: '1.21.111',
            autoRespawn: true,
            autoWithdraw: { enabled: false, intervalMinutes: 15, withdrawThreshold: 8000 },
            debug: false,
            ...botConfig
        };
        this.itemMapping = itemMapping;
        this.client = null;
        this.state = { status: 'OFFLINE' };
        this.inventory = new Map();
        this.requestIdCounter = -Math.floor(Math.random() * 1000);
        this.reconnectTimeout = null;
        this.autoWithdrawIntervalId = null;
        
        this.reconnectAttempts = [];
        this.lastSuccessfulLoginTime = null;
        this.quickDisconnectCount = 0;
        this.consecutiveConnectionFails = 0;

        this.logger = Object.fromEntries(
            Object.keys(logger).map(levelName => [
                levelName,
                (...args) => {
                    logger.setActiveBot(this);
                    logger[levelName](...args);
                    logger.setActiveBot(null);
                }
            ]).filter(entry => typeof entry[1] === 'function')
        );
    }

    /**
     * 根據 networkId 獲取物品的中文名稱
     * @param {number} networkId - 來自伺服器封包的物品ID
     * @returns {string} 物品的中文名稱或備用名稱
     */
    _getItemName(networkId) {
        const officialName = this.itemMapping.get(networkId);

        if (officialName) {
            const keyName = officialName.replace('minecraft:', '');
            const itemKey = `item.minecraft.${keyName}`;
            const blockKey = `block.minecraft.${keyName}`;

            if (mcLang[itemKey]) return mcLang[itemKey];
            if (mcLang[blockKey]) return mcLang[blockKey];
            
            return keyName.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }
        
        return `未知物品 (ID: ${networkId})`;
    }

    async connect() {
        if (this.state.status === 'CONNECTING' || this.state.status === 'ONLINE') {
            this.logger.warn('連線請求被忽略，機器人正在連線或已在線上。');
            return;
        }
        this.state.status = 'CONNECTING';
        this.logger.info(`正在連接至 ${this.config.host}:${this.config.port}...`);

        const usernameForLogin = this.config.offline ? '.' + this.config.botTag : this.config.botTag;
        this.client = createClient({
            host: this.config.host, port: this.config.port, version: this.config.version,
            offline: this.config.offline, username: usernameForLogin,
            profilesFolder: this.config.profilePath, connectTimeout: 10000
        });
        this._setupEventListeners();
    }

    disconnect(reason = '手動斷開連線') {
        // 總是嘗試關閉客戶端連線，無論內部狀態如何
        if (this.client && this.client.status !== ClientStatus.Disconnected) { // 只有在客戶端實際活躍時才記錄日誌
            this.logger.info(`手動斷開連線: ${reason}`);
        } else if (this.state.status === 'STOPPED') {
            // 如果已經停止且客戶端為 null/已關閉，則直接返回
            return;
        }

        this.state.status = 'STOPPED'; // 設定狀態為 STOPPED
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.stopAutoWithdraw();
        this.client?.disconnect(); // 強制關閉連線
        this.client = null; // 確保客戶端物件為 null
    }

    _setupEventListeners() {
        // [核心修正] 移除 whitelist 相關的無用程式碼
        this.client.on('packet', (packet) => {
            if (!this.config.debug) return;
            
            const ignoredPackets = ['network_chunk_publisher_update', 'level_chunk', 'set_entity_data', 'move_player', 'update_attributes'];
            if (!ignoredPackets.includes(packet.name)) {
                this.logger.debug(`[RAW PACKET] Name: ${packet.name}`);
                if (packet.name === 'inventory_content') {
                    this.logger.debug(` -> Window ID: ${packet.params.window_id}`);
                }
            }
        });

        this.client.on('spawn', () => {
            this.state.status = 'ONLINE';
            this.logger.info('✅ 成功登入伺服器！');
            this.lastSuccessfulLoginTime = Date.now();
            if (this.consecutiveConnectionFails > 0) {
                this.logger.info('連線成功，重置連續失敗計數器。');
                this.consecutiveConnectionFails = 0;
            }
            this.inventory.clear();
            if (this.config.autoWithdraw.enabled) {
                this.startAutoWithdraw();
            }
        });

        this.client.on('text', (packet) => this._handleText(packet));
        this.client.on('item_stack_response', (packet) => {
            packet.responses.forEach(res => {
                if (res.status === 'error') this.logger.error(`‼️ 物品堆疊請求失敗 (ID: ${res.request_id})`);
                else this.logger.debug(`✅ 物品堆疊請求成功 (ID: ${res.request_id})`);
            });
        });

        this.client.on('disconnect', (p) => this._onDisconnected('disconnect', p.message));
        this.client.on('error', (err) => this._onDisconnected('error', err.message));
        this.client.on('kick', (reason) => this._onDisconnected('kick', reason.message));
        this.client.on('close', () => this._onDisconnected('close', '連線被關閉'));
        this.client.on('entity_event', (packet) => this._handleAutoRespawn(packet));
        this.client.on('inventory_content', (packet) => {
            if (packet.window_id === 'inventory') {
                this.inventory.clear();
                packet.input.forEach((item, index) => { if (item.network_id !== 0) this.inventory.set(index, item); });
            }
        });
        this.client.on('inventory_slot', (packet) => {
            if (packet.window_id === 'inventory') {
                if (packet.item.network_id === 0) this.inventory.delete(packet.slot);
                else this.inventory.set(packet.slot, packet.item);
            }
        });
    }

    _onDisconnected(source, reason) {
        if (this.state.status === 'OFFLINE' || this.state.status === 'STOPPED') return;
        const wasConnecting = this.state.status === 'CONNECTING';
        const wasOnline = this.state.status === 'ONLINE';
        this.logger.warn(`斷線事件來源 [${source}]，原因: ${reason || '未知'}`);
        if (reason && reason.includes('another location')) {
            this.logger.error('帳號從其他裝置登入，將不會自動重連。');
            this.state.status = 'STOPPED';
            this.stopAutoWithdraw();
            return;
        }
        this.state.status = 'OFFLINE';
        this.client = null;
        this.stopAutoWithdraw();
        if (wasOnline) {
            this.consecutiveConnectionFails = 0;
            const QUICK_DISCONNECT_WINDOW = 60 * 1000;
            const MAX_QUICK_DISCONNECTS = 3;
            if (this.lastSuccessfulLoginTime && (Date.now() - this.lastSuccessfulLoginTime < QUICK_DISCONNECT_WINDOW)) {
                this.quickDisconnectCount++;
                this.logger.warn(`偵測到快速斷線 (登入後 ${((Date.now() - this.lastSuccessfulLoginTime) / 1000).toFixed(1)} 秒)，計數: ${this.quickDisconnectCount}/${MAX_QUICK_DISCONNECTS}`);
            } else {
                if (this.quickDisconnectCount > 0) {
                    this.logger.info('連線穩定超過一分鐘，重置快速斷線計數器。');
                    this.quickDisconnectCount = 0;
                }
            }
        } else if (wasConnecting) {
            this.consecutiveConnectionFails++;
            this.logger.warn(`連線失敗，連續失敗次數: ${this.consecutiveConnectionFails}`);
        }
        this._scheduleReconnect();
    }

    _scheduleReconnect() {
        if (this.reconnectTimeout || isShuttingDown()) {
            if (!isShuttingDown()) this.logger.debug('一個重連任務已在排程中，忽略本次請求。');
            return;
        }
        if (this.state.status === 'STOPPED' || !this.config.enabled) return;
        const RECONNECT_DELAY = 10000;
        const COOLDOWN_DELAY = 60 * 1000;
        const LONG_TERM_WINDOW = 30 * 60 * 1000;
        const MAX_LONG_TERM_ATTEMPTS = 10;
        const SUSPENSION_DELAY = 1 * 60 * 1000;
        const MAX_QUICK_DISCONNECTS = 3;
        let delay = RECONNECT_DELAY;
        let reason = '';
        const now = Date.now();
        this.reconnectAttempts = this.reconnectAttempts.filter(time => now - time < LONG_TERM_WINDOW);
        if (this.reconnectAttempts.length >= MAX_LONG_TERM_ATTEMPTS) {
            delay = SUSPENSION_DELAY;
            reason = `[最高級警告] 在過去 30 分鐘內已重連超過 ${MAX_LONG_TERM_ATTEMPTS} 次！將暫停 ${delay / 1000 / 60} 分鐘以避免問題。`;
            this.logger.error(reason);
            this.reconnectAttempts = [];
        }
        else if (this.quickDisconnectCount >= MAX_QUICK_DISCONNECTS) {
            delay = COOLDOWN_DELAY;
            reason = `[指數退避] 快速斷線次數過於頻繁！將進入 ${delay / 1000} 秒的冷卻時間。`;
            this.logger.warn(reason);
            this.quickDisconnectCount = 0;
        }
        else {
            if (this.consecutiveConnectionFails > 0) {
                reason = `[標準重試] 連線失敗，將在 ${delay / 1000} 秒後重試...`;
                this.logger.warn(reason);
            } else {
                reason = `準備在 ${delay / 1000} 秒後重連...`;
                this.logger.info(reason);
            }
        }
        if (this.client && this.client.status !== ClientStatus.Disconnected) this.client.disconnect();
        this.reconnectAttempts.push(Date.now());
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    async _handleAutoRespawn(packet) {
        if (!this.config.autoRespawn) return;
        if (this.client && packet.event_id === 'death_animation' && BigInt(packet.runtime_entity_id) === this.client.entityId) {
            this.logger.info('偵測到死亡，將在 2 秒後自動重生...');
            await sleep(2000);
            this.manualRespawn();
        }
    }

    manualRespawn() {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('離線狀態，無法手動重生。');
            return;
        }
        try {
            this.client.queue('respawn', {
                position: { x: 0, y: 0, z: 0 },
                state: 2,
                runtime_entity_id: this.client.entityId
            });
            this.logger.info('已發送重生請求。');
        } catch (e) {
            this.logger.error(`重生時發生錯誤: ${e.message}`);
        }
    }

    _handleText(packet) {
        const { type, source_name, message: rawMessage } = packet;
        if (type === 'jukebox_popup') return;
        const message = parseMinecraftColors(rawMessage);
        if (type === 'chat') {
            this.logger.chat(`<${source_name}> ${message}`);
        } else {
            this.logger.chat(`[Server] ${message}`);
            if (this.config.autoWithdraw.enabled && rawMessage.includes('達到在線賺錢上限')) {
                this.logger.info('偵測到餘額上限訊息，觸發提款檢查。');
                this._checkAndWithdraw();
            }
        }
    }

    runCommand(command) {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('離線或未完全連接狀態，無法執行指令');
            return;
        }
        const commandToSend = command.startsWith('/') ? command.substring(1) : command;
        this.logger.debug(`執行指令: /${commandToSend}`);
        try {
            this.client.queue('command_request', {
                command: `/${commandToSend}`,
                origin: { type: 'player', uuid: this.client.profile?.uuid || '', request_id: '' },
                internal: false
            });
        } catch (error) {
            this.logger.error(`執行指令時發生錯誤: ${error.message}`);
            this._onDisconnected('command_error', error.message);
        }
    }

    listInventory() {
        console.log(`\n--- ${this.config.botTag} 的物品欄內容 ---`);
        if (this.inventory.size === 0) { console.log('物品欄是空的。'); return; }
        const sortedInventory = Array.from(this.inventory.entries()).sort((a, b) => a[0] - b[0]);
        let inventoryOutput = '';
        for (const [slot, item] of sortedInventory) {
            const itemName = this._getItemName(item.network_id);
            const customName = item.extra?.nbt?.nbt?.value?.display?.value?.Name?.value || '';
            inventoryOutput += `- 欄位: ${String(slot).padEnd(2)} | ${itemName.padEnd(20)} | 數量: ${String(item.count).padEnd(3)} | ${parseMinecraftColors(customName)}\n`;
        }
        console.log(inventoryOutput.trim());
        console.log(`------------------------------------`);
    }

    _waitForNextUiContent(timeout) {
        return new Promise((resolve, reject) => {
            let timeoutHandle;
            const listener = (packet) => {
                if (packet.window_id !== 'inventory') {
                    this.logger.debug(`[UI_LISTENER] 收到UI更新，Window ID: ${packet.window_id}`);
                    cleanup();
                    resolve(packet);
                }
            };

            const cleanup = () => {
                clearTimeout(timeoutHandle);
                this.client?.removeListener('inventory_content', listener);
            };

            this.client.on('inventory_content', listener);

            timeoutHandle = setTimeout(() => {
                cleanup();
                reject(new Error(`等待UI內容更新超時 (${timeout / 1000}秒)`));
            }, timeout);
        });
    }

    async getUiContents(command, identifierKeyword, timeout) {
        if (this.state.status !== 'ONLINE' || !this.client) {
            throw new Error('機器人未連線，無法開啟UI。');
        }
    
        return new Promise((resolve, reject) => {
            let listener;
            let timeoutHandle;
    
            const cleanup = () => {
                if (listener) this.client?.removeListener('inventory_content', listener);
                if (timeoutHandle) clearTimeout(timeoutHandle);
            };
    
            listener = (packet) => {
                if (packet.window_id === 'inventory') return;
    
                const isTargetContainer = packet.input?.some(item => {
                    const customName = item?.extra?.nbt?.nbt?.value?.display?.value?.Name?.value || '';
                    return customName.includes(identifierKeyword);
                });
    
                if (isTargetContainer) {
                    this.logger.debug(`成功鎖定 ${command} 主容器！ (Window ID: ${packet.window_id})`);
                    cleanup();
                    const items = (packet.input || []).map((item, index) => ({ ...item, slot: item.slot ?? index }));
                    resolve({ windowId: packet.window_id, items });
                } else {
                    this.logger.debug(`收到非目標容器封包 (ID: ${packet.window_id})，繼續等待...`);
                }
            };
    
            this.client.on('inventory_content', listener);
            this.runCommand(command);
            this.logger.debug(`已發送 /${command} 指令，正在等待伺服器回應...`);
    
            timeoutHandle = setTimeout(() => {
                cleanup();
                reject(new Error(`等待 ${command} 內容超時 (${timeout / 1000}秒)，找不到包含關鍵字 "${identifierKeyword}" 的UI。`));
            }, timeout);
        });
    }

    _sendStackRequest(item, actionType, sourceContainer, windowId) {
        if (!item || typeof item.stack_id === 'undefined') {
            this.logger.error(`物品無效或缺少 stack_id，無法發送請求。`);
            return false;
        }
        const requestId = this.requestIdCounter--;
        const destination = actionType === 'take' ? { container_id: 'cursor', slot: 0 } : { container_id: 'inventory', slot: 0 };
        
        const payload = {
            requests: [{
                request_id: requestId,
                actions: [{
                    type_id: actionType,
                    count: item.count,
                    source: { slot_type: { container_id: sourceContainer, window_id: windowId }, slot: item.slot, stack_id: item.stack_id },
                    destination: { slot_type: destination, stack_id: 0 }
                }],
                custom_names: [],
                cause: -1
            }]
        };
        try {
            if (!this.client) {
                this.logger.error('發送請求失敗: client 已離線。');
                return false;
            }
            this.client.queue('item_stack_request', payload);
            return true;
        } catch (e) {
            this.logger.error(`發送封包時發生錯誤: ${e.message}\n${e.stack}`);
            return false;
        }
    }

    listAtmContents() {
        if (this.state.status !== 'ONLINE' || isShuttingDown()) {
            this.logger.warn('機器人離線或程式正在關閉，無法執行 ATM 操作。');
            return;
        }
        this.logger.info(`已將 [查看 ATM 內容] 任務加入隊列。`);
        atmQueue.addTask(this, async () => {
                let atmData;
                try {
                    atmData = await this.getUiContents('atm', '餘額', ATM_OPERATION_TIMEOUT);
                    if (!atmData || !atmData.items) return;
                    let listOutput = `--- ${this.config.botTag} 的 ATM 物品列表 ---\n`;
                    let hasVisibleItems = false;
                    atmData.items.forEach(item => {
                        if (item && item.network_id !== 0 && item.network_id !== -649) {
                            hasVisibleItems = true;
                            const itemName = this._getItemName(item.network_id);
                            const customName = item.extra?.nbt?.nbt?.value?.display?.value?.Name?.value || '';
                            listOutput += `- 欄位: ${String(item.slot).padEnd(2)} | ${itemName.padEnd(20)} | ${parseMinecraftColors(customName)}\n`;
                        }
                    });
                    if (!hasVisibleItems) listOutput += "ATM 看起來是空的。\n";
                    console.log("\n" + listOutput.trim());
                } catch (error) {
                    this.logger.error(`[ATM隊列] 任務 "查看 ATM 內容" 執行失敗: ${error.message}`);
                } finally {
                    if (this.client && atmData?.windowId) {
                        this.client.queue('container_close', { window_id: atmData.windowId });
                    }
                }
            }, `查看 ATM 內容 (${this.config.botTag})`);
    }

    performTakeAction(slot, actionType) {
        if (this.state.status !== 'ONLINE' || isShuttingDown()) {
            this.logger.warn('機器人離線或程式正在關閉，無法執行 ATM 操作。');
            return;
        }
        this.logger.info(`已將 [從欄位 ${slot} 執行 "${actionType}"] 任務加入隊列。`);
        atmQueue.addTask(this, async () => {
                let atmData;
                try {
                    atmData = await this.getUiContents('atm', '餘額', ATM_OPERATION_TIMEOUT);
                    if (!atmData || !atmData.items) return;
                    const item = atmData.items.find(i => i.slot === slot);
                    if (!item || item.network_id === -649 || item.network_id === 0) {
                        this.logger.error(`欄位 ${slot} 上沒有可操作的項目。`);
                    } else {
                        this.logger.debug(`在欄位 ${slot} 找到目標: ${this._getItemName(item.network_id)} (StackID: ${item.stack_id})`);
                        if (this._sendStackRequest(item, actionType, 'container', atmData.windowId)) {
                            await sleep(500);
                        }
                    }
                } catch (error) {
                    this.logger.error(`[ATM隊列] 任務 "從 ATM 欄位 ${slot} 拿取物品" 執行失敗: ${error.message}`);
                } finally {
                    if (this.client && atmData?.windowId) {
                        this.client.queue('container_close', { window_id: atmData.windowId });
                    }
                }
            }, `從 ATM 欄位 ${slot} 拿取物品 (${this.config.botTag})`);
    }

    startAutoWithdraw() {
        if (this.autoWithdrawIntervalId) {
            this.logger.warn('自動提款已經在執行中。');
            return;
        }
        const intervalMs = this.config.autoWithdraw.intervalMinutes * 60 * 1000;
        if (intervalMs <= 0) {
            this.logger.error('自動提款間隔時間設定無效。');
            return;
        }
        this.logger.info(`已啟動自動提款，每 ${this.config.autoWithdraw.intervalMinutes} 分鐘檢查一次。`);
        this._runAutoWithdrawLoop(intervalMs);
    }

    _runAutoWithdrawLoop(intervalMs) {
        this._checkAndWithdraw();
        this.autoWithdrawIntervalId = setTimeout(() => this._runAutoWithdrawLoop(intervalMs), intervalMs);
    }

    stopAutoWithdraw() {
        if (this.autoWithdrawIntervalId) {
            clearTimeout(this.autoWithdrawIntervalId);
            this.autoWithdrawIntervalId = null;
            this.logger.info('已停止自動提款。');
        }
    }

    _checkAndWithdraw() {
        if (this.state.status !== 'ONLINE' || isShuttingDown()) {
            this.logger.debug('機器人離線或程式正在關閉，跳過此次提款檢查。');
            return;
        }
        const alreadyInQueue = atmQueue.getQueue().some(item => 
            item.bot.config.botTag === this.config.botTag && item.description.includes('自動提款')
        );
        if (alreadyInQueue) {
            this.logger.debug('自動提款任務已在隊列中，本次跳過。');
            return;
        }
        this.logger.info('偵測到提款需求，已將任務加入 ATM 隊列。');
        atmQueue.addTask(this, () => this._executeWithdrawal(), `自動提款檢查 (${this.config.botTag})`);
    }
    
    async _executeWithdrawal() {
        let atmData;
        try {
            atmData = await this.getUiContents('atm', '餘額', ATM_OPERATION_TIMEOUT);
            if (!atmData) return;
            const balanceItem = atmData.items.find(item => item.slot === 13);
            const customName = balanceItem?.extra?.nbt?.nbt?.value?.display?.value?.Name?.value || '';
            const cleanName = customName.replace(/§[0-9a-fk-or]/g, '');
            const match = cleanName.match(/餘額 \$([0-9,]+)/);
            if (!match || !match[1]) {
                this.logger.warn('無法從 ATM 介面解析餘額。');
                return;
            }
            const balanceString = match[1].replace(/,/g, '');
            const balance = parseInt(balanceString, 10);
            if (isNaN(balance)) {
                this.logger.warn(`解析出的餘額不是一個有效的數字: ${match[1]}`);
                return;
            }
            this.logger.info(`目前餘額: $${balance}`);
            if (balance >= this.config.autoWithdraw.withdrawThreshold) {
                this.logger.info(`餘額已達 $${this.config.autoWithdraw.withdrawThreshold} 門檻，準備執行提款序列。`);
                await this._performWithdrawalSequence(balance, atmData);
                atmData = null; // 防止 finally 區塊重複關閉
            }
        } catch (error) {
             this.logger.error(`[ATM隊列] 任務 "自動提款檢查" 執行失敗: ${error.message}`);
        } finally {
            if (this.client && atmData?.windowId) {
                this.client.queue('container_close', { window_id: atmData.windowId });
            }
        }
    }

    async _performWithdrawalSequence(initialAmount, initialAtmData) {
        this.logger.info(`---- 開始執行提款序列，目標金額: $${initialAmount} ----`);
        let remainingAmount = initialAmount;
        let currentWindowId = initialAtmData.windowId;
        let currentItems = initialAtmData.items;

        const denominations = [
            { amount: 10000, slot: 9 }, { amount: 1000, slot: 10 },
            { amount: 100, slot: 11 }, { amount: 10, slot: 12 }
        ];

        try {
            while (remainingAmount >= 10) {
                if (this.state.status !== 'ONLINE' || isShuttingDown()) {
                    throw new Error("提款序列中斷，因為機器人已離線或程式正在關閉。");
                }

                const denToClick = denominations.find(d => remainingAmount >= d.amount);
                if (!denToClick) {
                    this.logger.info('剩餘金額小於最小面額，提款完成。');
                    break;
                }

                const itemToClick = currentItems.find(item => item.slot === denToClick.slot);
                if (!itemToClick || itemToClick.network_id === 0) {
                    this.logger.warn(`在提款序列中找不到欄位 ${denToClick.slot} 的物品`);
                    break;
                }

                this.logger.info(`提款 $${denToClick.amount} (剩餘目標: $${remainingAmount})`);
                
                if (!this._sendStackRequest(itemToClick, 'take', 'container', currentWindowId)) {
                    this.logger.error(`點擊欄位 ${denToClick.slot} 失敗，將在下次檢查時重試。`);
                    break;
                }

                const updatePacket = await this._waitForNextUiContent(ATM_OPERATION_TIMEOUT);
                
                currentWindowId = updatePacket.window_id;
                currentItems = (updatePacket.input || []).map((item, index) => ({ ...item, slot: item.slot ?? index }));
                
                remainingAmount -= denToClick.amount;
                
                await sleep(800);
            }
        } catch (error) {
            this.logger.error(`[ATM隊列] 提款序列中發生錯誤: ${error.message}`);
        } finally {
            if (this.client && currentWindowId) {
                this.client.queue('container_close', { window_id: currentWindowId });
                this.logger.info("---- 提款序列執行完畢，已關閉 ATM 介面 ----");
            }
        }
    }

    listHomes() {
        if (this.state.status !== 'ONLINE' || isShuttingDown()) {
            this.logger.warn('機器人離線或程式正在關閉，無法執行 Home 操作。');
            return;
        }
        this.logger.info(`已將 [列出家列表] 任務加入隊列。`);
        homeQueue.addTask(this, async () => {
                let homeData;
                try {
                    homeData = await this.getUiContents('homelist', '操作說明:', HOME_OPERATION_TIMEOUT);
                    if (!homeData || !homeData.items) {
                        this.logger.error('無法獲取 Home 介面內容，任務中止。');
                        return;
                    }

                    let listOutput = `--- ${this.config.botTag} 的 Home 列表 ---\n`;
                    let hasHomes = false;
                    
                    homeData.items.forEach(item => {
                        const customName = item.extra?.nbt?.nbt?.value?.display?.value?.Name?.value || '';
                        if (item && item.network_id !== 0 && item.network_id !== -161 && item.network_id !== -643 && customName && !customName.includes('操作說明')) {
                            hasHomes = true;
                            const cleanName = parseMinecraftColors(customName).replace(/\\x1b\\[[0-9;]*m/g, '').trim();
                            listOutput += `- ${cleanName}\n`;
                        }
                    });

                    if (!hasHomes) {
                        listOutput += "找不到任何家。\n";
                    }
                    console.log("\n" + listOutput.trim());

                } catch (error) {
                    this.logger.error(`[Home隊列] 任務 "列出家列表" 執行失敗: ${error.message}`);
                } finally {
                    if (this.client && homeData?.windowId) {
                        this.client.queue('container_close', { window_id: homeData.windowId });
                    }
                }
            }, `列出家列表 (${this.config.botTag})`);
    }

    teleportHome(homeName) {
        if (this.state.status !== 'ONLINE' || isShuttingDown()) {
            this.logger.warn('機器人離線或程式正在關閉，無法執行 Home 操作。');
            return;
        }
        this.logger.info(`已將 [傳送到 ${homeName}] 任務加入隊列。`);
        homeQueue.addTask(this, async () => {
                let homeData;
                try {
                    homeData = await this.getUiContents('homelist', '操作說明:', HOME_OPERATION_TIMEOUT);
                    if (!homeData || !homeData.items) {
                        this.logger.error('無法獲取 Home 介面內容，任務中止。');
                        return;
                    }

                    const homeItem = homeData.items.find(item => {
                        if (!item.extra?.nbt) return false;
                        const customName = item.extra.nbt.nbt.value.display?.value?.Name?.value || '';
                        const cleanName = customName.replace(/§[0-9a-fk-or]/g, '');
                        return cleanName.toLowerCase() === homeName.toLowerCase();
                    });

                    if (homeItem) {
                        this.logger.debug(`找到家 "${homeName}"，於欄位 ${homeItem.slot} 準備點擊傳送...`);
                        this._sendStackRequest(homeItem, 'take', 'container', homeData.windowId);
                        await sleep(500);
                    } else {
                        this.logger.error(`在 Home 介面中找不到名為 "${homeName}" 的家。`);
                    }
                } catch (error) {
                    this.logger.error(`[Home隊列] 任務 "傳送到 ${homeName}" 執行失敗: ${error.message}`);
                } finally {
                    if (this.client && homeData?.windowId) {
                       this.logger.debug(`Home 任務完成，Window ID ${homeData.windowId} 應由伺服器關閉。`);
                    }
                }
            }, `傳送到 ${homeName} (${this.config.botTag})`);
    }
}

module.exports = Bot;
