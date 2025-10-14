const fs = require('fs');
const path = require('path');
const readline = require('readline');
const util = require('util');
const mineflayer = require('mineflayer');
const ChatMessage = require('prismarine-chat');
const tpsPlugin = require('mineflayer-tps')(mineflayer);

// =================================================================================
// 1. UTILITIES (工具函式庫)
// =================================================================================

const Colors = {
    Reset: "\x1b[0m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m", FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m"
};

const logger = (() => {
    let rlInterface = null;
    let activeBotForLogging = null;
    const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CHAT: 4 };

    const log = (level, ...args) => {
        if (level === LogLevel.DEBUG && !process.env.DEBUG) return;
        const isChat = level === LogLevel.CHAT;

        const levelMap = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
        const levelColorMap = { 0: Colors.FgMagenta, 1: Colors.FgGreen, 2: Colors.FgYellow, 3: Colors.FgRed, 4: Colors.Reset };

        const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).substring(0, 19);
        const botPrefix = activeBotForLogging ? `[${Colors.FgCyan}${activeBotForLogging.config.botTag}${Colors.Reset}] ` : '';

        const color = levelColorMap[level] || Colors.Reset;
        const levelName = levelMap[level] || 'LOG';
        const standardPrefix = `[${timestamp}] [${color}${levelName}${Colors.Reset}] `;

        const message = util.format(...args);

        if (rlInterface && rlInterface.prompt) {
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 1);
            if (isChat) console.log(`[${timestamp}] ` + botPrefix + message);
            else console.log(standardPrefix + botPrefix + color + message + Colors.Reset);
            rlInterface.prompt(true);
        } else {
            if (isChat) console.log(`[${timestamp}] ` + botPrefix + message);
            else console.log(standardPrefix + botPrefix + color + message + Colors.Reset);
        }
    };
    return {
        setRl: (rl) => { rlInterface = rl; },
        unsetRl: () => { rlInterface = null; },
        setActiveBot: (bot) => { activeBotForLogging = bot; },
        debug: (...args) => log(LogLevel.DEBUG, ...args),
        info: (...args) => log(LogLevel.INFO, ...args),
        warn: (...args) => log(LogLevel.WARN, ...args),
        error: (...args) => log(LogLevel.ERROR, ...args),
        chat: (...args) => log(LogLevel.CHAT, ...args),
        Colors: Colors
    };
})();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class TPSMonitor {
    constructor(bot) {
        this.bot = bot;

        // --- 1. Network Packet Method ---
        this.packetTpsValues = [];
        this.lastPacketTime = Date.now();
        if (this.bot && this.bot._client) {
            this.bot._client.on('update_time', () => this.onTimeUpdate());
        }

        // --- 2. Physics Tick Method ---
        this.tickTimes = [];
        this.lastTickTime = Date.now();
        this.physicsTPS = 20.0;
        this.bot.on('physicsTick', () => this.onPhysicsTick());

        // --- 3. Game Time Method ---
        this.tpsHistory = [];
        this.lastGameTime = 0n; // Use a safe default value
        this.lastRealTime = Date.now();
        this.gameTimeInterval = null; // Will be started later
    }

    start() {
        // This method is called safely after the bot has spawned
        if (this.bot.time && typeof this.bot.time.bigTime !== 'undefined') {
            this.lastGameTime = this.bot.time.bigTime;
            this.lastRealTime = Date.now();
            if (!this.gameTimeInterval) { // Prevent creating multiple intervals
                this.gameTimeInterval = setInterval(() => this.calculateGameTimeTPS(), 1000);
            }
        } else {
            logger.warn('TPSMonitor: bot.time is not available on start(). Game Time TPS method will be disabled.');
        }
    }

    // --- Network Packet Logic ---
    onTimeUpdate() {
        const now = Date.now();
        const timeElapsed = (now - this.lastPacketTime) / 1000;
        if (timeElapsed > 0) {
            const tps = Math.min(20.0, 20.0 / timeElapsed);
            this.packetTpsValues.push(tps);
            if (this.packetTpsValues.length > 20) this.packetTpsValues.shift();
        }
        this.lastPacketTime = now;
    }
    getPacketTPS() {
        if (this.packetTpsValues.length === 0) return 20.0;
        return this.packetTpsValues.reduce((a, b) => a + b) / this.packetTpsValues.length;
    }

    // --- Physics Tick Logic ---
    onPhysicsTick() {
        const now = Date.now();
        const deltaTime = now - this.lastTickTime;
        this.tickTimes.push(deltaTime);
        if (this.tickTimes.length > 100) this.tickTimes.shift();
        if (this.tickTimes.length >= 20) {
            const avgDeltaTime = this.tickTimes.reduce((a, b) => a + b) / this.tickTimes.length;
            this.physicsTPS = Math.min(20, 1000 / avgDeltaTime);
        }
        this.lastTickTime = now;
    }
    getPhysicsTPS() {
        return this.physicsTPS;
    }

    // --- Game Time Logic ---
    calculateGameTimeTPS() {
        // Safety check in case this is called before `start`
        if (!this.bot.time || typeof this.bot.time.bigTime === 'undefined') return;

        const currentGameTime = this.bot.time.bigTime;
        const currentRealTime = Date.now();
        const gameTimeDiff = Number(currentGameTime - this.lastGameTime);
        const realTimeDiff = currentRealTime - this.lastRealTime;

        if (realTimeDiff > 0) {
            const tps = (gameTimeDiff / realTimeDiff) * 1000;
            this.tpsHistory.push(Math.min(20, tps));
            if (this.tpsHistory.length > 60) this.tpsHistory.shift();
        }
        this.lastGameTime = currentGameTime;
        this.lastRealTime = currentRealTime;
    }
    getGameTimeTPS() {
        if (this.tpsHistory.length === 0) return 20.0;
        return this.tpsHistory.reduce((a, b) => a + b) / this.tpsHistory.length;
    }

    // --- Plugin Method (Wrapper) ---
    async getPluginTPS() {
        try {
            return await this.bot.getTps();
        } catch (e) {
            return -1; // 表示錯誤
        }
    }
    
    // --- Cleanup ---
    stop() {
        if (this.gameTimeInterval) {
            clearInterval(this.gameTimeInterval);
            this.gameTimeInterval = null;
        }
    }
}


// =================================================================================
// 2. BOT CLASS (機器人核心類別)
// =================================================================================

const OMEN_CHECK_INTERVAL = 15000; // 備用檢查間隔 (15秒)
const OMEN_REAPPLY_DELAY = 1500; // 效果結束後重新使用的延遲 (1.5秒)

class BotJava {
    constructor(botConfig) {
        this.config = {
            version: '1.21',
            auth: 'microsoft',
            viewerPort: 0,
            enableViewer: false,
            debugMode: false,
            startWorkOnLogin: false, // Default work mode setting
            enableItemDropDetection: false,
            ...botConfig
        };
        this.client = null;
        this.state = { status: 'OFFLINE' };
        this.reconnectTimeout = null;
        this.viewer = {
            port: null,
            instance: null
        };
        
        // --- [新設計] 工作模式狀態 ---
        this.isWorking = false;
        this.workTimeout = null; // 用於儲存自我維持循環的 setTimeout
        
        this.effectsLogged = false;
        this.lastKnownEffects = new Map();

        this.reconnectAttempts = [];
        this.lastSuccessfulLoginTime = null;
        this.quickDisconnectCount = 0;
        this.consecutiveConnectionFails = 0;
        this.isDisconnecting = false;
        this.connectionGlitchHandled = false;
        this.tpsMonitor = null;

        this.ominousTrialKeyDrops = 0;
        // ++ 新增 ++ 用於追蹤已處理的掉落物實體，避免重複觸發
        this.processedDropEntities = new Set();

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

    async connect() {
        if (this.state.status === 'CONNECTING' || this.state.status === 'ONLINE') {
            this.logger.warn('連線請求被忽略，機器人正在連線或已在線上。');
            return;
        }

        this.isDisconnecting = false;
        this.state.status = 'CONNECTING';
        this.logger.info(`正在連接至 ${this.config.host}:${this.config.port}...`);

        try {
            this.client = mineflayer.createBot({
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                version: this.config.version,
                auth: 'microsoft',
                profilesFolder: path.join(__dirname, 'profiles'),
                hideErrors: true,
                onMsaCode: (data) => {
                    this.logger.info(`-------------------------------------------------`);
                    this.logger.warn(`[帳號認證] ${this.config.botTag} 需要手動認證！`);
                    this.logger.info(`請在瀏覽器中開啟此網址: ${data.verification_uri}`);
                    this.logger.info(`並輸入此代碼: ${data.user_code}`);
                    this.logger.info(`-------------------------------------------------`);
                }
            });
            this.client.loadPlugin(tpsPlugin);
            this.tpsMonitor = new TPSMonitor(this.client);
            this._setupEventListeners();
        } catch (error) {
            this.logger.error(`建立機器人時發生初始錯誤: ${error.message}`);
            this._onDisconnected('initialization_error', error);
        }
    }

    disconnect(reason = '手動斷開連線') {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.isWorking) {
            this.stopWork('手動斷開連線');
        }
        this.state.status = 'STOPPED';
        this.logger.info(`手動斷開連線: ${reason}`);
        this.client?.quit();
    }

    async startViewer(viewerModule, canvasModule) {
        if (!this.config.enableViewer) return;
        if (this.viewer.instance) {
            this.logger.warn('監看視窗已經在運行中。');
            return;
        }

        this.logger.info(`正在於 http://localhost:${this.config.viewerPort} 啟動網頁監看視窗...`);

        try {
            viewerModule(this.client, {
                port: this.config.viewerPort,
                firstPerson: false,
                Canvas: canvasModule.Canvas
            });
            this.viewer.instance = this.client.viewer;
            if (!this.viewer.instance) {
                throw new Error('Viewer instance was not created on the client after initialization.');
            }
            this.viewer.port = this.config.viewerPort;
            this.logger.info(`✅ 監看視窗已在 http://localhost:${this.viewer.port} 上運行`);
        } catch (error) {
            this.logger.error(`啟動監看視窗時發生錯誤: ${error.message}`);
            this.logger.warn('此機器人的監看功能將被停用以避免後續錯誤。');
            this.config.enableViewer = false;
        }
    }
    
    startWork() {
        if (this.isWorking) {
            this.logger.warn('工作模式已經在執行中。');
            return;
        }
        this.isWorking = true;
        this.logger.info('✅ 工作模式已啟動。將持續維持 Omen 效果。');
        this._maintainOmenEffect();
    }

    stopWork(reason = '手動停止') {
        if (!this.isWorking) {
            this.logger.warn('工作模式尚未啟動。');
            return;
        }
        this.isWorking = false;
        if (this.workTimeout) {
            clearTimeout(this.workTimeout);
            this.workTimeout = null;
        }
        this.logger.info(`⏹️ 工作模式已停止。原因: ${reason}`);
    }

    _debugAvailableEffects() {
        if (!this.client) return;
        try {
            const mcData = require('minecraft-data')(this.client.version);
            this.logger.info(`--- [DEBUG] Minecraft ${this.client.version} 支援的效果列表 ---`);
            Object.keys(mcData.effectsByName).sort().forEach(name => {
                const effect = mcData.effectsByName[name];
                this.logger.info(`  - ${name} (ID: ${effect.id})`);
            });
            this.logger.info(`--- [DEBUG] 效果列表結束 ---`);
        } catch (e) {
            this.logger.error('無法獲取效果列表:', e.message);
        }
    }

    _hasOmenEffect() {
        if (!this.client) return false;
        try {
            const mcData = require('minecraft-data')(this.client.version);

            if (this.config.debugMode && !this.effectsLogged) {
                this._debugAvailableEffects();
                this.effectsLogged = true;
            }
            
            const targetEffects = ['TrialOmen', 'BadOmen'].map(name =>
                mcData.effectsByName[name]
            ).filter(Boolean);

            if (targetEffects.length === 0) {
                 this.logger.warn(`此版本 (${this.client.version}) 不支援 TrialOmen 或 BadOmen 效果。將繼續嘗試使用瓶子。`);
                return false;
            }

            return targetEffects.some(effect => {
                const hasEffect = this.client.entity.effects[effect.id] !== undefined;
                if(hasEffect) {
                    this.logger.debug(`偵測到已存在效果: ${effect.name}，無需使用瓶子。`);
                }
                return hasEffect;
            });

        } catch (e) {
            this.logger.error('檢查 Omen 效果時發生錯誤:', e.message);
            return false;
        }
    }

    async _maintainOmenEffect() {
        if (!this.isWorking) {
            return;
        }
        
        try {
            if (this.state.status === 'ONLINE' && this.client) {
                this.logger.debug('[工作循環] 正在檢查 Omen 狀態...');

                if (!this._hasOmenEffect()) {
                    this.logger.info('未偵測到 Omen 效果，開始補充...');
                    
                    const ominousBottle = this.client.inventory.items().find(item => item.name === 'ominous_bottle');

                    if (!ominousBottle) {
                        this.logger.warn('庫存中找不到 Ominous Bottle，將在下次檢查時重試。');
                    } else {
                        this.logger.info('找到 Ominous Bottle，正在裝備並使用...');
                        await this.client.equip(ominousBottle, 'hand');
                        this.logger.debug('裝備完成，準備使用。');

                        // --- [優化] 使用事件驅動的方式等待效果，而非固定延遲 ---
                        const effectAppliedPromise = new Promise((resolve) => {
                            const mcData = require('minecraft-data')(this.client.version);
                            const targetEffectIds = ['TrialOmen', 'BadOmen']
                                .map(name => mcData.effectsByName[name]?.id)
                                .filter(Boolean);

                            const onEffect = (entity, effect) => {
                                if (entity === this.client.entity && targetEffectIds.includes(effect.id)) {
                                    clearTimeout(timeout); // 清除超時計時器
                                    this.client.removeListener('entityEffect', onEffect);
                                    resolve(true);
                                }
                            };

                            // 設定一個 5 秒的超時，以防萬一伺服器沒有回應
                            const timeout = setTimeout(() => {
                                this.client.removeListener('entityEffect', onEffect);
                                resolve(false);
                            }, 5000);

                            this.client.on('entityEffect', onEffect);
                        });

                        // 先啟動監聽，再使用物品
                        await this.client.activateItem();
                        this.logger.info('已使用 Ominous Bottle，等待伺服器回應...');

                        const success = await effectAppliedPromise;

                        if (success) {
                            this.logger.info('✅ 成功偵測到 Omen 相關效果！');
                        } else {
                            this.logger.warn('警告: 使用 Ominous Bottle 後 5 秒內未收到預期效果。');
                        }
                    }
                } else {
                     this.logger.debug('Omen 效果存在，無需操作。');
                }
            } else {
                this.logger.debug('[工作循環] 機器人非線上狀態，跳過本次操作檢查。');
            }
        } catch (error) {
            this.logger.error(`在工作循環中發生錯誤: ${error.message}`);
        } finally {
            if (this.isWorking) {
                this.workTimeout = setTimeout(() => this._maintainOmenEffect(), OMEN_CHECK_INTERVAL);
            }
        }
    }


    _setupEventListeners() {
        this.client.on('login', () => {
            this.logger.info(`使用帳號 ${this.client.username} 成功登入認證伺服器。`);
        });

        this.client.on('spawn', async () => {
            this.lastKnownEffects.clear();
            this.ominousTrialKeyDrops = 0;
            // ++ 新增 ++ 重生或重連時清空已處理列表
            this.processedDropEntities.clear();
            this.logger.info('ominous_trial_key 掉落計數器已重置。');

            if (this.state.status === 'CONNECTING') {
                this.state.status = 'ONLINE';
                this.logger.info('✅ 成功登入伺服器！');
                this.lastSuccessfulLoginTime = Date.now();
                this.connectionGlitchHandled = false;

                if (this.tpsMonitor) {
                    this.tpsMonitor.start(); // Safely start the time-based TPS monitoring
                }

                if (this.consecutiveConnectionFails > 0) {
                    this.logger.info('連線成功，重置連續失敗計數器。');
                    this.consecutiveConnectionFails = 0;
                }
                if (this.config.enableViewer) {
                    await this.startViewer(global.viewerModule, global.canvasModule);
                }

                // --- [REVISED] Start/Resume work logic ---
                if (this.config.startWorkOnLogin && !this.isWorking) {
                    // Case 1: First time login, config says start, and it's not already running.
                    this.logger.info('根據設定，自動啟動工作模式...');
                    this.startWork();
                } else if (this.isWorking && !this.workTimeout) {
                    // Case 2: It was working before disconnect (isWorking is true), so we just need to resume the loop.
                    // This now also covers the case where startWorkOnLogin is true but it's a reconnect.
                    this.logger.info('偵測到斷線重連，正在恢復工作模式...');
                    // We don't call startWork() to avoid the warning. We just restart the loop.
                    this._maintainOmenEffect();
                }

            } else {
                this.logger.debug('機器人已重生 (例如：因傳送或切換世界)。');
            }
        });

        this.client.on('entityEffect', (entity, effect) => {
            if (entity === this.client.entity) {
                const lastEffect = this.lastKnownEffects.get(effect.id);

                if (!lastEffect || lastEffect.amplifier !== effect.amplifier) {
                    const mcData = require('minecraft-data')(this.client.version);
                    const effectName = Object.keys(mcData.effectsByName).find(name =>
                        mcData.effectsByName[name].id === effect.id
                    );

                    const action = !lastEffect ? "獲得" : "等級變為";
                    const name = effectName || `未知效果 (ID: ${effect.id})`;

                    this.logger.info(`[狀態更新] ${action}效果: ${name} (等級: ${effect.amplifier + 1})`);
                }

                this.lastKnownEffects.set(effect.id, { id: effect.id, amplifier: effect.amplifier });
            }
        });
        
        this.client.on('entityEffectEnd', (entity, effect) => {
            if (entity === this.client.entity && this.lastKnownEffects.has(effect.id)) {
                const mcData = require('minecraft-data')(this.client.version);
                const effectName = Object.keys(mcData.effectsByName).find(name =>
                    mcData.effectsByName[name].id === effect.id
                );
                const name = effectName || `未知效果 (ID: ${effect.id})`;
                this.logger.info(`[狀態更新] 效果已結束: ${name}`);

                this.lastKnownEffects.delete(effect.id);
                
                if (this.isWorking && ['TrialOmen', 'BadOmen'].includes(effectName)) {
                    this.logger.info('偵測到 Omen 效果結束，立即安排一次快速檢查...');
                    
                    if (this.workTimeout) clearTimeout(this.workTimeout);
                    
                    this.workTimeout = setTimeout(() => this._maintainOmenEffect(), OMEN_REAPPLY_DELAY);
                }
            }
        });

        this.client.on('itemDrop', (entity) => {
            if (!this.config.enableItemDropDetection) return;
            if (!entity || !entity.metadata) return;

            // ++ 修改 ++ 檢查此掉落物實體是否已被處理
            if (this.processedDropEntities.has(entity.id)) {
                this.logger.debug(`[掉落物] 忽略已處理的掉落物實體: ${entity.id}`);
                return;
            }
            
            this.logger.info(`🎯 itemDrop 事件觸發！實體ID: ${entity.id}, 名稱: ${entity.name}`);
            if (this.config.debugMode) {
                 this.logger.debug(`完整 metadata: ${util.inspect(entity.metadata, { depth: null })}`);
            }

            try {
                let itemData;
                let slotPosition;

                // ++ 修改 ++ 根據日誌和版本特性，更精準地判斷 slot 位置
                if (this.client.supportFeature('itemsAreAlsoBlocks')) { // < 1.13
                    slotPosition = 6;
                } else { // >= 1.13
                    const majorVersion = parseInt(this.client.version.split('.')[1]);
                    if (this.client.majorVersion === '1.13') {
                        slotPosition = 6;
                    } else if (majorVersion >= 20) { // 適用於 1.20, 1.21+
                        slotPosition = 9;
                    } else { // 適用於 1.14 -> 1.19
                        slotPosition = 7;
                    }
                }

                itemData = entity.metadata[slotPosition];

                if (!itemData) {
                    this.logger.warn(`[掉落物] 在預期的 metadata[${slotPosition}] 中找不到物品數據，將嘗試遍歷搜尋...`);
                    for (const [key, value] of Object.entries(entity.metadata)) {
                        if (value && (value.itemId !== undefined || value.blockId !== undefined)) {
                            this.logger.info(`[掉落物] 在 metadata[${key}] 找到備用物品數據！`);
                            itemData = value;
                            break; 
                        }
                    }
                }
                
                if (!itemData) {
                    this.logger.error(`[掉落物] 錯誤：在所有 metadata 中都找不到有效的物品數據。`);
                    return;
                }
                
                // 兼容舊版 (blockId) 來獲取物品 ID。
                const itemId = itemData.itemId === undefined ? itemData.blockId : itemData.itemId;
                const itemCount = itemData.itemCount || 1;

                if (itemId === undefined) return;

                const item = this.client.registry.items[itemId];
                if (!item) {
                    this.logger.warn(`[掉落物] 根據 ID ${itemId} 找不到對應的物品信息。`);
                    return;
                }

                const itemName = item.displayName;
                const internalName = item.name;
                const position = entity.position.floored();

                if (internalName === 'ominous_trial_key' || this.config.debugMode) {
                    this.logger.info(`[掉落物] 偵測到物品: ${itemName} (數量: ${itemCount}) 在座標 (X: ${position.x}, Y: ${position.y}, Z: ${position.z})`);
                }
                
                // ++ 新增 ++ 成功處理後，將實體ID加入集合中
                this.processedDropEntities.add(entity.id);
                
                if (internalName === 'ominous_trial_key') {
                    this.ominousTrialKeyDrops += itemCount;
                    this.logger.info(`[戰利品] ominous_trial_key 掉落了 ${itemCount} 個，目前總計: ${this.ominousTrialKeyDrops}`);
                }

                if (internalName.includes('minecart')) {
                    this.logger.info(`  -> 这是一个矿车掉落物！`);
                }
            } catch (error) {
                this.logger.error(`處理掉落物時發生錯誤: ${error.message}`);
                this.logger.debug(error.stack);
            }
        });

        this.client.on('entityGone', (entity) => {
            // ++ 新增 ++ 當掉落物實體消失時，從集合中移除，釋放記憶體
            if (this.processedDropEntities.has(entity.id)) {
                this.processedDropEntities.delete(entity.id);
                this.logger.debug(`[掉落物] 已從追蹤列表中移除實體: ${entity.id}`);
            }
        });

        this.client.on('entitySpawn', (entity) => {
            if (this.config.debugMode && entity.name && (entity.name.toLowerCase() === 'item' || entity.name.toLowerCase() === 'item_stack')) {
                this.logger.info(`🔍 偵測到掉落物實體生成 (名稱: ${entity.name}, ID: ${entity.id})`);
                this.logger.debug(`[掉落物偵錯-SPAWN] 實體位於 ${entity.position.floored()}`);
            }
        });

        this.client.on('message', (jsonMsg, position) => {
            try {
                const messageText = jsonMsg.toString();

                if (
                    jsonMsg.color === 'red' &&
                    messageText.includes('You are already trying to connect to a server!') &&
                    !this.connectionGlitchHandled
                ) {
                    this.logger.warn('偵測到因伺服器重啟造成的連線狀態鎖死，將強制斷線並依正常程序重連。');
                    this.connectionGlitchHandled = true;
                    this._onDisconnected('connection_glitch', 'Forced disconnect due to server restart lock-up.');
                    return;
                }

                if (position === 'game_info') {
                    if (messageText.includes('earned') || messageText.includes('上線5分鐘派發金錢')) {
                        return;
                    }
                }
                const cleanMessageText = messageText.replace(/§[0-9a-fk-or]/g, '');
                if (cleanMessageText.includes('達到在線賺錢上限')) {
                    this.logger.info('偵測到「達到在線賺錢上限」訊息，將自動提款...');
                    setTimeout(() => {
                        takeItemFromWindow(this, '/atm', '虛擬銀行 (ATM)', 9);
                    }, 1500);
                }

                this.logger.chat(jsonMsg.toAnsi());
            } catch (error) {
                this.logger.warn('攔截到一個可忽略的聊天封包解析錯誤，已忽略以維持連線穩定。');
                this.logger.debug(`錯誤詳情: ${error.message}`);
            }
        });

        this.client.on('kicked', (reason, loggedIn) => this._onDisconnected('kicked', reason));
        this.client.on('error', (err) => this._onDisconnected('error', err));
        this.client.on('end', (reason) => this._onDisconnected('end', reason));
    }

    _onDisconnected(source, reason) {
        if (this.isDisconnecting || this.state.status === 'STOPPED') return;
        this.isDisconnecting = true;
        
        if (this.workTimeout) {
            clearTimeout(this.workTimeout);
            this.workTimeout = null;
            this.logger.warn('偵測到斷線，已暫停工作循環。將在重連後自動恢復。');
        }

        const wasConnecting = this.state.status === 'CONNECTING';
        const wasOnline = this.state.status === 'ONLINE';

        let reasonText = '未知原因';
        let isLoginElsewhere = false;
        let isNetworkError = false;

        if (reason) {
            if (reason instanceof Error) {
                reasonText = reason.message;
                if (reason.code === 'ECONNRESET') {
                    isNetworkError = true;
                    reasonText = `網路連線被重設 (${reason.code})`;
                } else if (reasonText.includes('timed out')) {
                    isNetworkError = true;
                    reasonText = `客戶端超時 (Keep-Alive 未收到回應)`;
                }
            } else if (typeof reason === 'string') {
                reasonText = reason;
            } else if (typeof reason.toAnsi === 'function') {
                reasonText = reason.toAnsi().replace(/\u001b\[[0-9;]*m/g, '');
            } else {
                try { reasonText = JSON.stringify(reason); }
                catch (e) { reasonText = util.inspect(reason); }
            }
        }

        const cleanMessageText = reasonText.replace(/§[0-9a-fk-or]/g, '');
        if (cleanMessageText.includes('logged_in_elsewhere') || cleanMessageText.includes('duplicate_login')) {
            isLoginElsewhere = true;
        }

        this.logger.warn(`斷線事件來源 [${source}]，原因: ${cleanMessageText}`);

        if (this.tpsMonitor) {
            this.tpsMonitor.stop();
            this.tpsMonitor = null;
        }

        if (this.client) {
            this.client.removeAllListeners();
            this.client = null;
        }
        
        this.lastKnownEffects.clear();
        this.effectsLogged = false;
        // ++ 新增 ++ 斷線時清空已處理列表
        this.processedDropEntities.clear();

        if (isLoginElsewhere) {
            this.logger.error('帳號從其他裝置登入，將停止自動重連。');
            this.state.status = 'STOPPED';
            return;
        }

        if (cleanMessageText.includes('Authentication error')) {
            this.logger.error('帳號認證失敗！請檢查您的帳號或刪除 profiles 資料夾後重試。');
            this.state.status = 'STOPPED';
            return;
        }

        this.state.status = 'OFFLINE';
        
        // ======================= RECONNECT LOGIC FIX START =======================
        if (wasOnline) {
            const QUICK_DISCONNECT_WINDOW = 60 * 1000;
            // Handle case where lastSuccessfulLoginTime might be null, though unlikely if wasOnline is true
            const timeSinceLogin = this.lastSuccessfulLoginTime ? Date.now() - this.lastSuccessfulLoginTime : QUICK_DISCONNECT_WINDOW;

            if (timeSinceLogin < QUICK_DISCONNECT_WINDOW) {
                // This was a quick disconnect. Treat it like a connection failure for backoff purposes.
                this.quickDisconnectCount++;
                this.consecutiveConnectionFails++; // KEY CHANGE: Increment instead of resetting
                this.logger.warn(`偵測到快速斷線 (登入後 ${(timeSinceLogin / 1000).toFixed(1)} 秒)，快速斷線計數: ${this.quickDisconnectCount}，連續失敗計數: ${this.consecutiveConnectionFails}`);
            } else {
                // Connection was stable, so this is a fresh disconnect event. Reset counters.
                if (this.quickDisconnectCount > 0) {
                    this.logger.info('連線穩定超過一分鐘，重置快速斷線計數器。');
                    this.quickDisconnectCount = 0;
                }
                if (this.consecutiveConnectionFails > 0) {
                    this.logger.info('連線穩定，重置連續失敗計數器。');
                    this.consecutiveConnectionFails = 0;
                }
            }
        } else if (wasConnecting) {
            // This was a failure during the connection process.
            this.consecutiveConnectionFails++;
            this.logger.warn(`連線失敗，連續失敗次數: ${this.consecutiveConnectionFails}`);
        }
        // ======================= RECONNECT LOGIC FIX END =========================

        if (this.state.status !== 'STOPPED') {
            this._scheduleReconnect({ isNetworkError });
        }
    }

    _scheduleReconnect(context = {}) {
        if (this.reconnectTimeout || !this.config.enabled) return;

        const { isNetworkError = false } = context;

        const BASE_DELAY = 15 * 1000;
        const MAX_BACKOFF_DELAY = 120 * 1000;
        const QUICK_DISCONNECT_COOLDOWN = 5 * 60 * 1000;
        const SUSPENSION_DELAY = 15 * 60 * 1000;
        const LONG_TERM_WINDOW = 30 * 60 * 1000;
        const MAX_LONG_TERM_ATTEMPTS = 10;
        const MAX_QUICK_DISCONNECTS = 3;

        let delay = BASE_DELAY;
        let reason = '';
        const now = Date.now();

        this.reconnectAttempts = this.reconnectAttempts.filter(time => now - time < LONG_TERM_WINDOW);

        if (this.reconnectAttempts.length >= MAX_LONG_TERM_ATTEMPTS) {
            delay = SUSPENSION_DELAY;
            reason = `[暫停連線] 在過去 30 分鐘內已重連超過 ${MAX_LONG_TERM_ATTEMPTS} 次！將暫停 ${delay / 1000 / 60} 分鐘。`;
            this.logger.error(reason);
            this.reconnectAttempts = [];
        }
        else if (this.quickDisconnectCount >= MAX_QUICK_DISCONNECTS) {
            delay = QUICK_DISCONNECT_COOLDOWN;
            reason = `[冷卻機制] 快速斷線次數過於頻繁！將進入 ${delay / 1000 / 60} 分鐘的冷卻時間。`;
            this.logger.warn(reason);
            this.quickDisconnectCount = 0;
        }
        else if (isNetworkError && this.quickDisconnectCount > 0) {
            delay = QUICK_DISCONNECT_COOLDOWN;
            reason = `[冷卻機制] 因伺服器網路問題導致快速斷線，將進入 ${delay / 1000 / 60} 分鐘的冷卻時間。`;
            this.logger.warn(reason);
            this.quickDisconnectCount = 0;
        }
        else if (this.consecutiveConnectionFails > 0) {
            delay = Math.min(BASE_DELAY * Math.pow(2, this.consecutiveConnectionFails - 1), MAX_BACKOFF_DELAY);
            reason = `[指數退避] 連線失敗，將在 ${delay / 1000} 秒後重試...`;
            this.logger.warn(reason);
        }
        else {
            reason = `準備在 ${delay / 1000} 秒後重連...`;
            this.logger.info(reason);
        }

        this.reconnectAttempts.push(Date.now());
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (this.state.status !== 'STOPPED') {
                this.connect();
            }
        }, delay);
    }

    runCommand(command) {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('離線或未完全連接狀態，無法執行指令');
            return;
        }
        this.logger.debug(`執行指令: ${command}`);
        this.client.chat(command);
    }
}

// =================================================================================
// 3. CONSOLE INTERFACE (主控台介面)
// =================================================================================
function nbtToJson(nbt) {
    if (typeof nbt !== 'object' || nbt === null) {
        return nbt;
    }
    if (nbt.type && nbt.value !== undefined) {
        switch (nbt.type) {
            case 'list':
                return nbt.value.value.map(nbtToJson);
            case 'compound':
                return nbtToJson(nbt.value);
            default:
                return nbt.value;
        }
    }
    if (!nbt.type) {
        const newObj = {};
        for (const key in nbt) {
            newObj[key] = nbtToJson(nbt[key]);
        }
        return newObj;
    }
    return nbt;
}

async function openWindow(botInstance, command, windowName) {
    const bot = botInstance.client;
    if (!bot) {
        botInstance.logger.warn('機器人未連線，無法開啟視窗。');
        return null;
    }

    let onWindowOpen;
    try {
        botInstance.logger.info(`正在發送 ${command} 指令並等待 ${windowName} 介面...`);
        const window = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                bot.removeListener('windowOpen', onWindowOpen);
                reject(new Error(`等待 ${windowName} 視窗開啟超時 (10秒)`));
            }, 10000);

            onWindowOpen = (win) => {
                if (win.id === 0) {
                    botInstance.logger.debug("已忽略玩家物品欄開啟事件。");
                    return;
                }
                clearTimeout(timer);
                bot.removeListener('windowOpen', onWindowOpen);
                resolve(win);
            };

            bot.on('windowOpen', onWindowOpen);
            botInstance.runCommand(command);
        });

        const pollingStart = Date.now();
        const POLLING_TIMEOUT = 10000;
        while (Date.now() - pollingStart < POLLING_TIMEOUT) {
            if (window.containerItems().length > 0) {
                botInstance.logger.debug(`在 ${Date.now() - pollingStart}ms 後成功載入視窗物品。`);
                return window;
            }
            await sleep(250);
        }
        botInstance.logger.warn(`無法從 ${windowName} 載入任何物品。`);
        return window;
    } catch (error) {
        botInstance.logger.error(`開啟 ${windowName} 視窗時發生錯誤: ${error.message}`);
        return null;
    }
}

function getCustomName(item, botInstance) {
    try {
        if (!item) return null;

        if (botInstance.config.debugMode && item.components) {
            botInstance.logger.info(`[Component Debug] 正在檢測 ${item.name} 的 components: ${util.inspect(item.components, { depth: null })}`);
        }

        let customNameData = null;

        if (Array.isArray(item.components)) {
            const customNameComponent = item.components.find(c => c.type === 'minecraft:custom_name' || c.type === 'custom_name');
            if (customNameComponent && customNameComponent.data) {
                customNameData = nbtToJson(customNameComponent.data);
            }
        }
        else if (item.nbt?.value?.display?.value?.Name?.value) {
            customNameData = JSON.parse(item.nbt.value.display.value.Name.value);
        }

        if (customNameData) {
            const ChatMessageParser = ChatMessage(botInstance.client.registry);
            const parsedName = new ChatMessageParser(customNameData).toString().trim();
            if (parsedName) {
                return parsedName;
            }
        }

        return null;
    } catch (e) {
        botInstance.logger.warn(`解析物品 ${item.name} 的自訂名稱時發生錯誤: ${e.message}`);
        return null;
    }
}

async function listWindowItems(botInstance, command, windowName) {
    let window = null;
    try {
        window = await openWindow(botInstance, command, windowName);
        if (!window) return;

        const items = window.containerItems();
        botInstance.logger.chat(`--- ${botInstance.config.botTag} 的 ${windowName} 物品列表 ---`);

        const relevantItems = items.filter(item => item.name !== 'gray_stained_glass_pane');

        if (relevantItems.length === 0) {
            botInstance.logger.chat('   -> 介面內沒有可操作的物品。');
        } else {
            const outputLines = relevantItems.map(item => {
                const slot = `欄位: ${String(item.slot).padEnd(3)}`;
                const displayName = item.displayName.padEnd(22);
                const customName = getCustomName(item, botInstance);

                if (customName) {
                    return `- ${slot} | ${displayName} | ${customName}`;
                } else {
                    return `- ${slot} | ${item.displayName}`;
                }
            });
            botInstance.logger.chat(outputLines.join('\n'));
        }
        botInstance.logger.chat(`------------------------------------`);

    } catch (error) {
        botInstance.logger.error(`處理 ${windowName} 視窗時發生錯誤: ${error.message}`);
        botInstance.logger.debug(error.stack);
    } finally {
        if (window && botInstance.client && botInstance.client.currentWindow && botInstance.client.currentWindow.id === window.id) {
            botInstance.client.closeWindow(window);
            botInstance.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉。 ---`);
        }
    }
}

async function takeItemFromWindow(botInstance, command, windowName, slot) {
    let window = null;
    try {
        window = await openWindow(botInstance, command, windowName);
        if (!window) return;

        const items = window.containerItems();
        const item = items.find(i => i.slot === slot);

        if (!item) {
            botInstance.logger.error(`欄位 ${slot} 中沒有物品。`);
            if (botInstance.config.debugMode) {
                botInstance.logger.debug("可用的容器欄位:", items.map(i => i.slot));
            }
            return;
        }

        botInstance.logger.info(`正在從 ${windowName} 的欄位 ${slot} 拿取 ${item.displayName}...`);
        await botInstance.client.clickWindow(slot, 0, 0);
        botInstance.logger.info(`✅ 已成功點擊欄位 ${slot}。`);

    } catch (error) {
        botInstance.logger.error(`從 ${windowName} 拿取物品時發生錯誤: ${error.message}`);
    } finally {
        if (window && botInstance.client && botInstance.client.currentWindow && botInstance.client.currentWindow.id === window.id) {
            await sleep(500);
            botInstance.client.closeWindow(window);
            botInstance.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉。 ---`);
        }
    }
}

async function interactiveWindowGui(botInstance, command, windowName, rl) {
    let window = null;
    const bot = botInstance.client;
    if (!bot) {
        botInstance.logger.warn('機器人未連線，無法開啟 GUI。');
        return;
    }

    try {
        window = await openWindow(botInstance, command, windowName);
        if (!window) return;

        logger.unsetRl();
        rl.pause();

        const guiLoop = async () => {
            console.log(`\n${Colors.FgCyan}--- ${botInstance.config.botTag} 的 ${windowName} 互動介面 ---${Colors.Reset}`);
            const items = window.containerItems().filter(item => item.name !== 'gray_stained_glass_pane');

            if (items.length === 0) {
                console.log('   -> 介面是空的。');
            } else {
                items.forEach(item => {
                    const customName = getCustomName(item, botInstance);
                    const name = customName ? `${item.displayName} | ${customName}` : item.displayName;
                    console.log(`  [${String(item.slot).padStart(2, ' ')}] ${name} (x${item.count})`);
                });
            }
            console.log(`--------------------------------------------------`);

            const answer = await new Promise(resolve => {
                rl.question(`輸入要點擊的欄位編號，或輸入 'exit'/'e' 離開: `, resolve);
            });
            const trimmedAnswer = answer.trim().toLowerCase();

            if (trimmedAnswer === 'exit' || trimmedAnswer === 'e') {
                return;
            }

            const slot = parseInt(trimmedAnswer, 10);
            if (isNaN(slot)) {
                console.log(`${Colors.FgRed}無效的輸入，請輸入數字欄位編號。${Colors.Reset}`);
                await guiLoop();
                return;
            }

            const allContainerItems = window.containerItems();
            const itemToClick = allContainerItems.find(i => i.slot === slot);

            if (!itemToClick) {
                console.log(`${Colors.FgYellow}欄位 ${slot} 是空的或無效。${Colors.Reset}`);
                if (botInstance.config.debugMode) {
                    console.log("Available slots:", allContainerItems.map(i => i.slot));
                }
            } else {
                console.log(`${Colors.FgGreen}正在點擊欄位 ${slot} (${itemToClick.displayName})...${Colors.Reset}`);
                await bot.clickWindow(slot, 0, 0);
                await sleep(500);
            }

            await guiLoop();
        };

        await guiLoop();

    } catch (error) {
        botInstance.logger.error(`互動式 GUI 發生錯誤: ${error.message}`);
    } finally {
        if (window && bot.currentWindow && bot.currentWindow.id === window.id) {
            bot.closeWindow(window);
            botInstance.logger.info(`已關閉 ${windowName} 介面。`);
        }
        rl.resume();
        logger.setRl(rl);
        rl.prompt(true);
    }
}

async function rideVehicle(botInstance, vehicleName, friendlyName) {
    const bot = botInstance.client;
    if (!bot) {
        botInstance.logger.warn('機器人未連線，無法執行操作。');
        return;
    }

    // 尋找 10 格內最近的載具
    const vehicle = bot.nearestEntity(entity =>
        entity.name && entity.name.toLowerCase().includes(vehicleName) && bot.entity.position.distanceTo(entity.position) < 10
    );

    if (!vehicle) {
        botInstance.logger.warn(`附近 10 格內沒有${friendlyName}。`);
        return;
    }

    try {
        await bot.mount(vehicle);
        botInstance.logger.info(`✅ 成功坐上${friendlyName}。`);
    } catch (error) {
        botInstance.logger.error(`坐上${friendlyName}時發生錯誤: ${error.message}`);
    }
}

function startConsole(botManager, botTagsByIndex) {
    console.log(`\n${Colors.FgCyan}======================================================${Colors.Reset}`);
    console.log(`${Colors.FgCyan}   Java 版帳號控制台已啟動                                       ${Colors.Reset}`);
    console.log(`${Colors.FgCyan}   輸入 help 查看指令                                          ${Colors.Reset}`);
    console.log(`${Colors.FgCyan}======================================================${Colors.Reset}`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logger.setRl(rl);
    let activeBot = botManager.size > 0 ? botManager.get(botTagsByIndex[0]) : null;
    if (activeBot) console.log(`預設操作目標已設定為: ${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}`);

    const setPrompt = () => {
        let prefix;
        if (activeBot) {
            const workIndicator = activeBot.isWorking ? '🟢' : '⚫️';
            prefix = `${workIndicator} [${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}]`;
        } else {
            prefix = `[${Colors.FgYellow}未選擇${Colors.Reset}]`;
        }
        rl.setPrompt(`${prefix}> `);
    };

    const parseCommandTargets = (args) => {
        const targets = [];
        const cleanArgs = [];
        let customTargetFound = false;

        for (const arg of args) {
            if (arg.startsWith('@')) {
                customTargetFound = true;
                const identifier = arg.substring(1);

                if (identifier.toLowerCase() === 'all') {
                    targets.push(...botManager.values());
                    continue;
                }

                const index = parseInt(identifier, 10);
                if (!isNaN(index) && index > 0 && index <= botTagsByIndex.length) {
                    const botTag = botTagsByIndex[index - 1];
                    if (botManager.has(botTag)) targets.push(botManager.get(botTag));
                    else logger.error(`找不到索引為 ${index} 的機器人。`);
                    continue;
                }

                const bot = botManager.get(identifier);
                if (bot) targets.push(bot);
                else logger.error(`找不到機器人: ${identifier}`);
            } else {
                cleanArgs.push(arg);
            }
        }

        if (!customTargetFound) {
            if (activeBot) targets.push(activeBot);
            else logger.error(`錯誤: 未指定目標 (@)，也未選擇預設機器人。`);
        }

        const uniqueTargets = [...new Set(targets)];
        return { targets: uniqueTargets, cleanArgs };
    };

    const commands = {
        'help': () => {
            console.log('\n--- 指令列表 ---');
            console.log('使用 @<BotTag|Index|all> 來指定指令目標。');
            console.log('若不指定目標，指令將對目前選擇的機器人執行。');
            console.log('--- 控制台指令 ---');
            console.log('   help                 - 顯示此幫助訊息');
            console.log('   list                 - 列出所有機器人及其狀態');
            console.log('   view [@目標]         - 顯示指定機器人的監看網址');
            console.log('   bot <BotTag|Index>   - 切換目前操作的機器人');
            console.log('   connect [@目標]      - 連線機器人');
            console.log('   disconnect [@目標]   - 斷開機器人連線');
            console.log('   exit                 - 優雅地關閉所有程式');
            console.log('   debug [@目標]        - 切換除錯模式 (顯示額外資訊)');
            console.log('--- 遊戲內指令 ---');
            console.log('   say <訊息> [@目標]   - 在遊戲中發言');
            console.log('   work <start|stop> [@目標] - 啟動或停止自動 Trial Omen 工作模式');
            console.log('   mount <cart|boat> [@目標] - 騎乘附近的礦車或船');
            console.log('   dismount [@目標]     - 從坐騎上下來');
            console.log('   pos [@目標]          - 取得目前座標');
            console.log('   tps [@目標]          - 取得伺服器目前的 TPS (多種方法)');
            console.log('   test drop [@目標]    - 丟棄物品以測試 itemDrop 事件');
            console.log('   atm list [@目標]     - 列出虛擬銀行 (ATM) 內容物');
            console.log('   atm take <欄位> [@目標] - 從 ATM 拿取物品');
            console.log('   atm gui [@目標]      - 開啟 ATM 互動介面');
            console.log('   inv list [@目標]     - 列出指定機器人的背包內容物');
            console.log('   /<指令> [@目標]      - 由指定或當前選擇的機器人執行指令');
            console.log('   //<指令>             - 由所有線上機器人執行指令 (快捷方式)');
        },
        'list': () => {
            console.log('\n--- 機器人狀態列表 ---');
            botTagsByIndex.forEach((botTag, index) => {
                const bot = botManager.get(botTag);
                const statusColors = { 'ONLINE': Colors.FgGreen, 'CONNECTING': Colors.FgYellow, 'OFFLINE': Colors.FgRed, 'STOPPED': Colors.FgMagenta };
                const color = statusColors[bot.state.status] || Colors.Reset;
                const isActive = activeBot && bot.config.botTag === activeBot.config.botTag ? ` ${Colors.FgYellow}<-- 目前操作${Colors.Reset}` : '';
                const indexStr = `[${index + 1}]`.padEnd(4);
                const viewerStatus = bot.config.enableViewer ? (bot.viewer.port ? `http://localhost:${bot.viewer.port}` : '已設定') : '已停用';
                const workIndicator = bot.isWorking ? '🟢' : '⚫️';
                console.log(`${indexStr} - ${bot.config.botTag.padEnd(15)} | 狀態: ${color}${bot.state.status.padEnd(10)}${Colors.Reset} | 工作: ${workIndicator} | 監看: ${viewerStatus}${isActive}`);
            });
        },
        'view': (args) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => {
                if (!bot.config.enableViewer) {
                    bot.logger.warn('此機器人的監看功能已在設定檔中停用。');
                } else if (bot.viewer.port) {
                    bot.logger.info(`監看網址: http://localhost:${bot.viewer.port}`);
                } else {
                    bot.logger.warn('監看視窗尚未啟動或機器人未連線。');
                }
            });
        },
        'bot': ([target]) => {
            if (!target) return console.log(`\n目前選擇的機器人: ${activeBot ? activeBot.config.botTag : '無'}`);
            const identifier = target.startsWith('@') ? target.substring(1) : target;
            const index = parseInt(identifier, 10);
            let foundBot = null;
            if (!isNaN(index) && index > 0 && index <= botTagsByIndex.length) {
                foundBot = botManager.get(botTagsByIndex[index - 1]);
            } else {
                foundBot = botManager.get(identifier);
            }

            if (foundBot) {
                activeBot = foundBot;
                console.log(`\n已切換操作目標為: ${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}`);
            } else {
                logger.error(`找不到機器人: ${target}`);
            }
        },
        'connect': async (args) => {
            const { targets } = parseCommandTargets(args);
            for (const bot of targets) {
                await bot.connect();
            }
        },
        'disconnect': (args) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => bot.disconnect());
        },
        'exit': () => rl.close(),
        'debug': (args) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => {
                bot.config.debugMode = !bot.config.debugMode;
                bot.logger.info(`除錯模式已${bot.config.debugMode ? '開啟' : '關閉'}。`);
            });
        },
        'say': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            if (cleanArgs.length === 0) {
                logger.error('請輸入要發送的訊息。用法: say <訊息>');
                return;
            }
            const message = cleanArgs.join(' ');
            targets.forEach(bot => bot.runCommand(message));
        },
        'work': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (!['start', 'stop'].includes(subCommand)) {
                logger.error('無效的 work 指令。支援 "start", "stop"。');
                return;
            }

            targets.forEach(bot => {
                if (subCommand === 'start') {
                    if (bot.state.status === 'ONLINE') {
                        bot.startWork();
                    } else {
                        bot.logger.warn('機器人未上線，無法啟動工作模式。');
                    }
                } else if (subCommand === 'stop') {
                    bot.stopWork();
                }
            });
        },
        'mount': async (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (!['cart', 'boat'].includes(subCommand)) {
                logger.error('無效的 mount 指令。支援 "cart" (礦車), "boat" (船)。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE') {
                    bot.logger.warn('機器人未上線，無法騎乘。');
                    continue;
                }

                if (subCommand === 'cart') {
                    await rideVehicle(bot, 'minecart', '礦車');
                } else if (subCommand === 'boat') {
                    await rideVehicle(bot, 'boat', '船');
                }
            }
        },
        'dismount': (args) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn('機器人未上線，無法下坐騎。');
                    return;
                }
                if (bot.client.vehicle) {
                    bot.client.dismount();
                    bot.logger.info('已成功下坐騎。');
                } else {
                    bot.logger.warn('機器人目前沒有在任何坐騎上。');
                }
            });
        },
        'pos': (args) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn('機器人未上線，無法取得座標。');
                    return;
                }
                const pos = bot.client.entity.position;
                const message = `目前座標: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}`;
                bot.logger.info(message);
            });
        },
        'tps': async (args) => {
            const { targets } = parseCommandTargets(args);
            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client || !bot.tpsMonitor) {
                    bot.logger.warn('機器人未上線，無法取得 TPS。');
                    continue;
                }
                try {
                    const pluginTps = await bot.tpsMonitor.getPluginTPS();
                    const packetTps = bot.tpsMonitor.getPacketTPS();
                    const physicsTps = bot.tpsMonitor.getPhysicsTPS();
                    const gameTimeTps = bot.tpsMonitor.getGameTimeTPS();

                    const formatTps = (tps) => (tps < 0 ? '錯誤' : tps.toFixed(2).padStart(5));

                    bot.logger.info(`伺服器 TPS - [插件]: ${formatTps(pluginTps)} | [封包]: ${formatTps(packetTps)} | [物理]: ${formatTps(physicsTps)} | [時間]: ${formatTps(gameTimeTps)}`);

                } catch (error) {
                    bot.logger.error(`取得 TPS 時發生錯誤: ${error.message}`);
                }
            }
        },
        'test': async (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (subCommand !== 'drop') {
                logger.error('無效的 test 指令。目前僅支援 "test drop"。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn('機器人未上線，無法執行測試。');
                    continue;
                }

                try {
                    // 尋找背包中的第一個物品
                    const itemToToss = bot.client.inventory.items()[0];
                    if (itemToToss) {
                        bot.logger.info(`[測試] 正在從背包丟棄 '${itemToToss.displayName}' (x${itemToToss.count}) 以觸發 itemDrop 事件...`);
                        await bot.client.tossStack(itemToToss);
                        bot.logger.info(`[測試] 物品已丟出。請檢查控制台是否有 '[掉落物]' 相關的日誌訊息。`);
                    } else {
                        bot.logger.warn('[測試] 背包是空的，無法執行掉落測試。');
                    }
                } catch (error) {
                    bot.logger.error(`執行掉落測試時發生錯誤: ${error.message}`);
                }
            }
        },
        'atm': async (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0];

            if (targets.length === 0) {
                logger.error('錯誤: 未指定目標 (@)，也未選擇預設機器人來執行 atm 指令。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn(`機器人未上線或未完全初始化，無法執行 atm 指令。`);
                    continue;
                }

                switch (subCommand) {
                    case 'list':
                        await listWindowItems(bot, '/atm', '虛擬銀行 (ATM)');
                        break;
                    case 'take': {
                        const slot = parseInt(cleanArgs[1], 10);
                        if (isNaN(slot)) {
                            bot.logger.error('無效的欄位編號。用法: atm take <欄位編號>');
                            continue;
                        }
                        await takeItemFromWindow(bot, '/atm', '虛擬銀行 (ATM)', slot);
                        break;
                    }
                    case 'gui':
                        if (targets.indexOf(bot) > 0) {
                            bot.logger.warn(`atm gui 指令一次只能對一個機器人執行，已忽略 ${bot.config.botTag}。`);
                            continue;
                        }
                        await interactiveWindowGui(bot, '/atm', '虛擬銀行 (ATM)', rl);
                        break;
                    default:
                        bot.logger.error('無效的 atm 指令。支援 "list", "take", "gui"。');
                        break;
                }
            }
        },
        'inv': async (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0];

            if (subCommand !== 'list') {
                logger.error('無效的 inv 指令。目前僅支援 "inv list"。');
                return;
            }

            if (targets.length === 0) {
                logger.error('錯誤: 未指定目標 (@)，也未選擇預設機器人來執行 "inv list"。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn(`機器人未上線，無法執行 "inv list"。`);
                    continue;
                }

                try {
                    const items = bot.client.inventory.items();
                    const header = `--- [${bot.config.botTag} 的背包] 內容 ---`;
                    bot.logger.chat(header);

                    if (items.length === 0) {
                        bot.logger.chat('   -> 背包是空的。');
                    } else {
                        const outputLines = items.map(item => {
                            const itemName = item.displayName;
                            return `     - 欄位 ${String(item.slot).padEnd(3)} | ${itemName} (x${item.count})`;
                        });
                        bot.logger.chat(outputLines.join('\n'));
                    }
                    const footer = `------------------------------------`;
                    bot.logger.chat(footer);

                } catch (error) {
                    bot.logger.error(`執行 "inv list" 時發生錯誤: ${error.message}`);
                }
            }
        }
    };

    setPrompt();
    rl.prompt();

    rl.on('line', async (line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
            rl.prompt();
            return;
        }

        if (trimmedLine.startsWith('//')) {
            const commandToRun = trimmedLine.substring(1);
            if (commandToRun.length > 1) {
                logger.info(`[ALL] > ${commandToRun}`);
                botManager.forEach(bot => {
                    if (bot.state.status === 'ONLINE') bot.runCommand(commandToRun);
                });
            }
        } else {
            const [command, ...args] = trimmedLine.split(/\s+/);
            const handler = commands[command.toLowerCase()];
            if (handler) {
                await handler(args);
            } else if (trimmedLine.startsWith('/')) {
                const { targets } = parseCommandTargets(args);
                targets.forEach(bot => bot.runCommand(trimmedLine));
            }
            else {
                logger.error(`未知指令: '${command}'。輸入 'help' 查看可用指令。`);
            }
        }

        setPrompt();
        rl.prompt();
    });

    return rl;
}

// =================================================================================
// 4. MAIN EXECUTION (主程式入口)
// =================================================================================

async function main() {
    process.on('uncaughtException', (err, origin) => {
        logger.unsetRl();
        console.error('\n==================== UNCAUGHT EXCEPTION ====================');
        console.error('捕獲到未處理的頂層異常！這是一個嚴重錯誤，可能導致程式不穩定。');
        console.error(`來源 (Origin): ${origin}`);
        console.error(err);
        console.error('============================================================');
    });
    process.on('unhandledRejection', (reason, promise) => {
        logger.unsetRl();
        console.error('\n==================== UNHANDLED REJECTION ====================');
        console.error('捕獲到未處理的 Promise Rejection！');
        console.error('原因 (Reason):', reason);
        console.error('=============================================================');
    });

    if (!fs.existsSync(path.join(__dirname, 'config'))) fs.mkdirSync(path.join(__dirname, 'config'));
    if (!fs.existsSync(path.join(__dirname, 'profiles'))) fs.mkdirSync(path.join(__dirname, 'profiles'));

    let configFileName;

    if (process.env.NODE_ENV === 'test') {
        configFileName = 'accounts_java_test.json';
    } else {
        configFileName = 'accounts_java_stable.json';
    }

    const accountsPath = path.join(__dirname, 'config', configFileName);
    logger.info(`正在讀取設定檔: ${configFileName}`);

    if (!fs.existsSync(accountsPath)) {
        logger.error(`錯誤: 找不到設定檔！ (${path.join('config', configFileName)})`);
        logger.error(`請將 ${configFileName}.example (如果有的話) 複製為 ${configFileName} 並填寫您的帳號資訊。`);
        process.exit(1);
    }

    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    const botManager = new Map();
    const botTagsByIndex = [];

    const isAnyViewerEnabled = accounts.some(acc => acc.enabled && acc.enableViewer);

    if (isAnyViewerEnabled) {
        logger.info('偵測到監看功能已啟用，正在載入相關模組...');
        try {
            global.viewerModule = require('prismarine-viewer').mineflayer;
            global.canvasModule = require('canvas');
        } catch (e) {
            logger.error('無法載入監看模組！請確認您已執行 `bun install` 或 `npm install`。');
            logger.error(e.message);
            logger.warn('將在無監看模式下繼續運行...');
            accounts.forEach(acc => acc.enableViewer = false);
        }
    }

    let nextViewerPort = 3000;
    for (const config of accounts) {
        if (!config.botTag) {
            logger.warn('發現一個沒有 botTag 的帳號設定，已跳過。');
            continue;
        }

        if (config.enabled && config.enableViewer) {
            config.viewerPort = nextViewerPort;
            logger.info(`為 ${config.botTag} 分配監看埠: ${config.viewerPort}`);
            nextViewerPort++;
        } else {
            config.enableViewer = false;
        }

        botManager.set(config.botTag, new BotJava(config));
        botTagsByIndex.push(config.botTag);
    }
    logger.info(`已從 ${configFileName} 載入 ${botManager.size} 個帳號設定。`);

    const enabledAccounts = Array.from(botManager.values()).filter(bot => bot.config.enabled);
    if (enabledAccounts.length > 0) {
        logger.info(`找到 ${enabledAccounts.length} 個已啟用的帳號，將逐一連線...`);
        for (const bot of enabledAccounts) {
            bot.connect();
            if (enabledAccounts.length > 1) await sleep(5000);
        }
    }

    const rl = startConsole(botManager, botTagsByIndex);

    rl.on('close', async () => {
        logger.unsetRl();
        console.log(`\n\n${logger.Colors.FgYellow}--- 開始執行優雅關閉程序 ---${logger.Colors.Reset}`);
        console.log('正在斷開所有機器人連線...');
        for (const bot of botManager.values()) {
            if (bot.state.status !== 'STOPPED') {
                bot.disconnect('程式關閉');
            }
        }
        await sleep(500);
        console.log(`${logger.Colors.FgGreen}✓ 所有機器人已斷線。${logger.Colors.Reset}`);
        console.log(`${logger.Colors.FgYellow}--- 優雅關閉完成，程式即將退出 ---${logger.Colors.Reset}`);
        process.exit(0);
    });
}

main().catch(err => {
    logger.unsetRl();
    console.error('主程式發生致命錯誤:', err);
    process.exit(1);
});
