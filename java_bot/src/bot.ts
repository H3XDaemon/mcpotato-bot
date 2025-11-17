import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

import mineflayer from 'mineflayer';
import tpsPlugin from 'mineflayer-tps';

import { CustomBotOptions } from './interfaces';
import { logger, sleep } from './utils';
import { TPSMonitor } from './tps';
import { GuiManager } from './gui.js';
import { TaskManager } from './taskManager.js';
import { setupEventListeners } from './events';
export class BotJava {
    taskManager: TaskManager | null;
    config: any;
    gui: GuiManager | null;
    client: mineflayer.Bot | null;
    state: { status: string; };
    reconnectTimeout: NodeJS.Timeout | null;
    viewer: { port: number | null; instance: any | null; };
    isWorking: boolean;
    workTimeout: NodeJS.Timeout | null;
    antiAfkInterval: NodeJS.Timeout | null;
    effectsLogged: boolean;
    lastKnownEffects: Map<number, any>;
    reconnectAttempts: number[];
    reconnectContext: string;
    serverList: { host: string, port: number }[];
    currentServerIndex: number;
    ipBlacklist: Map<string, number>;
    BLACKLIST_COOLDOWN: number;
    lastSuccessfulLoginTime: number | null;
    quickDisconnectCount: number;
    consecutiveConnectionFails: number;
    isDisconnecting: boolean;
    isGuiBusy: boolean;
    connectionGlitchHandled: boolean;
    tpsMonitor: TPSMonitor | null;
    ominousTrialKeyDrops: number;
    processedDropEntities: Set<number>;
    expHistory: { time: number, points: number }[];
    expSamplesHour: { time: number, points: number }[];
    lastExpSampleTime: number;
    lastExpLogTime: number;
    logExpRate: boolean;
    logger: any;
    tpaWhitelist: Map<string, { allowTpa: boolean, allowTpaHere: boolean }>;
    lastScannedLevers: any[];

    constructor(botConfig: CustomBotOptions, serverList: { host: string, port: number }[]) {
        const defaultConfig = {
            version: '1.21',
            auth: 'microsoft',
            viewerPort: 0,
            enableViewer: false,
            debugMode: false,
            startWorkOnLogin: false,
            enableItemDropDetection: false,
            antiAfk: {
                enabled: false,
                intervalMinutes: 4
            },
            reconnectOnDuplicateLogin: {
                enabled: false,
                delayMinutes: 60
            },
            omenCheckInterval: 15000, // 新增 Omen 檢查間隔
            omenReapplyDelay: 1500 // 新增 Omen 重新使用延遲
        };
        this.config = { ...defaultConfig, ...botConfig };
        // Deep merge for nested antiAfk object to ensure defaults are kept
        if (botConfig && botConfig.antiAfk) {
            this.config.antiAfk = { ...defaultConfig.antiAfk, ...botConfig.antiAfk };
        }
        if (botConfig && botConfig.reconnectOnDuplicateLogin) {
            this.config.reconnectOnDuplicateLogin = { ...defaultConfig.reconnectOnDuplicateLogin, ...botConfig.reconnectOnDuplicateLogin };
        }

        this.serverList = serverList;
        this.currentServerIndex = 0;
        if (serverList.length > 0) {
            this.config.host = serverList[0].host;
            this.config.port = serverList[0].port;
        } else {
            // Fallback or error if no servers are provided
            this.config.host = ''; // Set to a default/invalid value
            this.config.port = 0;
        }

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
        this.antiAfkInterval = null; // For anti-AFK feature
        
        this.effectsLogged = false;
        this.lastKnownEffects = new Map();

        this.reconnectAttempts = [];
        this.reconnectContext = 'NONE';
        this.ipBlacklist = new Map();
        this.BLACKLIST_COOLDOWN = 5 * 60 * 1000; // 5 minutes
        this.lastSuccessfulLoginTime = null;
        this.quickDisconnectCount = 0;
        this.consecutiveConnectionFails = 0;
        this.isDisconnecting = false;
        this.isGuiBusy = false;
        this.gui = null;
        this.taskManager = null;
        this.connectionGlitchHandled = false;
        this.tpsMonitor = null;

        this.ominousTrialKeyDrops = 0;
        // ++ 新增 ++ 用於追蹤已處理的掉落物實體，避免重複觸發
        this.processedDropEntities = new Set();
        this.expHistory = [];
        this.expSamplesHour = [];
        this.lastExpSampleTime = 0;
        this.lastExpLogTime = 0;
        this.logExpRate = false;
        this.tpaWhitelist = new Map();
        this.lastScannedLevers = [];

        this.logger = Object.fromEntries(
            Object.keys(logger).map(levelName => [
                levelName,
                (...args: any[]) => {
                    logger.setActiveBot(this);
                    (logger as any)[levelName](...args);
                    logger.setActiveBot(null);
                }
            ]).filter(entry => typeof entry[1] === 'function')
        );
    }

    _loadTpaWhitelist() {
        const whitelistPath = path.join(__dirname, '..', 'config', 'tpa_whitelist.json');
        this.tpaWhitelist.clear(); // Clear existing whitelist before loading
        try {
            if (fs.existsSync(whitelistPath)) {
                const data = fs.readFileSync(whitelistPath, 'utf-8');
                const playerPermissions: { [key: string]: { allowTpa: boolean, allowTpaHere: boolean } } = JSON.parse(data);
                
                for (const playerName in playerPermissions) {
                    if (Object.prototype.hasOwnProperty.call(playerPermissions, playerName)) {
                        const lowerCasePlayerName = playerName.toLowerCase();
                        const permissions = playerPermissions[playerName];
                        this.tpaWhitelist.set(lowerCasePlayerName, {
                            allowTpa: permissions.allowTpa || false,
                            allowTpaHere: permissions.allowTpaHere || false
                        });
                    }
                }
                this.logger.info(`已成功加載 TPA 白名單，共 ${this.tpaWhitelist.size} 位玩家。`);
            } else {
                this.logger.warn('TPA 白名單文件 (config/tpa_whitelist.json) 不存在，將不會自動接受任何 TPA 請求。');
            }
        } catch (error: any) {
            this.logger.error(`加載 TPA 白名單時發生錯誤: ${error.message}`);
            this.tpaWhitelist.clear();
        }
    }

    async connect() {
        this._loadTpaWhitelist();
        if (this.state.status === 'CONNECTING' || this.state.status === 'ONLINE') {
            this.logger.warn('連線請求被忽略，機器人正在連線或已在線上。');
            return;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
            this.logger.info('手動連接，已清除預定的重連延遲。');
        }

        // ++ FIX ++ 手動連接時重設重連情境，避免卡在「重複登入」等特殊狀態
        this.reconnectContext = 'NONE';
        this.isDisconnecting = false;
        this.state.status = 'CONNECTING';

        if (this.serverList.length === 0) {
            this.logger.error('沒有可用的伺服器設定，無法連線。');
            this.state.status = 'STOPPED';
            return;
        }

        const currentServer = this.serverList[this.currentServerIndex];
        const serverTag = this.currentServerIndex === 0 ? '主要' : `備用-${this.currentServerIndex}`;
        this.logger.info(`[${serverTag}] 正在連接至 ${currentServer.host}:${currentServer.port}...`);

        try {
            this.client = mineflayer.createBot({
                host: currentServer.host,
                port: currentServer.port,
                username: this.config.username,
                version: this.config.version,
                auth: 'microsoft',
                profilesFolder: path.join(__dirname, '..', 'profiles'),
                hideErrors: true,
                onMsaCode: (data: any) => {
                    this.logger.info(`-------------------------------------------------`);
                    this.logger.warn(`[帳號認證] ${this.config.botTag} 需要手動認證！`);
                    this.logger.info(`請在瀏覽器中開啟此網址: ${data.verification_uri}`);
                    this.logger.info(`並輸入此代碼: ${data.user_code}`);
                    this.logger.info(`-------------------------------------------------`);
                }
            });
            this.client.loadPlugin(tpsPlugin);
            this.tpsMonitor = new TPSMonitor(this.client);
            this.gui = new GuiManager(this.client);
            this.taskManager = new TaskManager(this);

            // Register default tasks
            const { auctionHouseTask, playerWarpTask } = await import('./tasks.js');
            this.taskManager.register(auctionHouseTask);
            this.taskManager.register(playerWarpTask);

            if (this.config.debugMode) {
                const logDir = path.join(__dirname, '..', 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir);
                }
                const dumpFile = path.join(logDir, `packet_dump_${Date.now()}.log`);
                this.logger.info(`[Debug] Packet logging enabled. Dumping to: ${dumpFile}`);

                this.client._client.on('packet', (data: any, metadata: any) => {
                    const ignoredPackets = [
                        'keep_alive', 'position', 'look', 'position_look', 'rel_entity_move', 'entity_look', 'entity_head_look', 'entity_metadata', 'update_time', 'entity_velocity',
                        'add_entity', 'animation', 'block_event', 'block_update', 'boss_event', 'bundle', 'damage_event', 'entity_event', 'sync_entity_position',
                        'forget_level_chunk', 'level_particles', 'light_update', 'move_entity_pos', 'move_entity_pos_rot', 'move_entity_rot', 'ping',
                        'player_info_remove', 'player_info_update', 'player_position', 'remove_entities', 'remove_mob_effect', 'rotate_head',
                        'section_blocks_update', 'set_action_bar_text', 'set_entity_data', 'set_entity_motion', 'set_equipment', 'set_score',
                        'set_time', 'sound_effect', 'playerlist_header', 'teleport_entity', 'update_attributes', 'update_mob_effect'
                    ];
                    if (ignoredPackets.includes(metadata.name)) return;

                    const targetPackets = ['open_window', 'window_items', 'set_slot', 'close_window', 'custom_payload', 'plugin_message'];
                    
                    let line = `${new Date().toISOString()} | NAME: ${metadata.name}`;
                    if (targetPackets.includes(metadata.name)) {
                        line += ` | DATA: ${util.inspect(data, { depth: 4 })}\n---\n`;
                    } else {
                        line += '\n';
                    }
                    fs.appendFileSync(dumpFile, line);
                });
            }

            this._setupEventListeners();
        } catch (error: any) {
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

    async startViewer(viewerModule: any, canvasModule: any) {
        if (!this.config.enableViewer || !this.client) return;
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
        } catch (error: any) {
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

    async _debugAvailableEffects() {
        if (!this.client) return;
        try {
            const mcDataFactory = (await import('minecraft-data')).default;
            const mcData = mcDataFactory(this.client.version);
            this.logger.info(`--- [DEBUG] Minecraft ${this.client.version} 支援的效果列表 ---`);
            Object.keys(mcData.effectsByName).sort().forEach(name => {
                const effect = mcData.effectsByName[name];
                this.logger.info(`  - ${name} (ID: ${effect.id})`);
            });
            this.logger.info(`--- [DEBUG] 效果列表結束 ---`);
        } catch (e: any) {
            this.logger.error('無法獲取效果列表:', e.message);
        }
    }

    async _hasOmenEffect() {
        if (!this.client) return false;
        try {
            const mcDataFactory = (await import('minecraft-data')).default;
            const mcData = mcDataFactory(this.client.version);

            if (this.config.debugMode && !this.effectsLogged) {
                await this._debugAvailableEffects();
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
                if (!this.client) return false;
                const hasEffect = this.client.entity.effects[effect.id] !== undefined;
                if(hasEffect) {
                    this.logger.debug(`偵測到已存在效果: ${effect.name}，無需使用瓶子。`);
                }
                return hasEffect;
            });

        } catch (e: any) {
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

                if (!await this._hasOmenEffect()) {
                    this.logger.info('未偵測到 Omen 效果，開始補充...');
                    
                    const ominousBottle = this.client.inventory.items().find((item: any) => item.name === 'ominous_bottle');

                    if (!ominousBottle) {
                        this.logger.warn('庫存中找不到 Ominous Bottle，將在下次檢查時重試。');
                    } else {
                        this.logger.info('找到 Ominous Bottle，正在裝備並使用...');
                        await this.client.equip(ominousBottle, 'hand');
                        this.logger.debug('裝備完成，準備使用。');

                        // --- [優化] 使用事件驅動的方式等待效果，而非固定延遲 ---
                        const effectAppliedPromise = new Promise((resolve) => {
                            if (!this.client) {
                                resolve(false);
                                return;
                            }
                            const mcData = require('minecraft-data')(this.client.version);
                            const targetEffectIds = ['TrialOmen', 'BadOmen']
                                .map(name => mcData.effectsByName[name]?.id)
                                .filter(Boolean);

                            const onEffect = (entity: any, effect: any) => {
                                if (this.client && entity === this.client.entity && targetEffectIds.includes(effect.id)) {
                                    clearTimeout(timeout); // 清除超時計時器
                                    this.client.removeListener('entityEffect', onEffect);
                                    resolve(true);
                                }
                            };

                            // 設定一個 5 秒的超時，以防萬一伺服器沒有回應
                            const timeout = setTimeout(() => {
                                if (this.client) {
                                    this.client.removeListener('entityEffect', onEffect);
                                }
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
            }
        } catch (error: any) {
            this.logger.error(`在工作循環中發生錯誤: ${error.message}`);
        } finally {
            if (this.isWorking) {
                this.workTimeout = setTimeout(() => this._maintainOmenEffect(), this.config.omenCheckInterval);
            }
        }
    }

    _setupEventListeners() {
        setupEventListeners(this);
    }

    _onDisconnected(source: string, reason: string | Error) {
        if (this.isDisconnecting || this.state.status === 'STOPPED') {
            return;
        }
        this.isDisconnecting = true;

        // --- [NEW] Anti-AFK Cleanup ---
        if (this.antiAfkInterval) {
            clearInterval(this.antiAfkInterval);
            this.antiAfkInterval = null;
            this.logger.info('Anti-AFK 計時器已清除。');
        }
        
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
                if ((reason as any).code === 'ECONNRESET') {
                    isNetworkError = true;
                    reasonText = `網路連線被重設 (${(reason as any).code})`;
                } else if (reasonText.includes('timed out')) {
                    isNetworkError = true;
                    reasonText = `客戶端超時 (Keep-Alive 未收到回應)`;
                }
            } else if (typeof reason === 'string') {
                reasonText = reason;
            } else if (typeof (reason as any).toAnsi === 'function') {
                reasonText = (reason as any).toAnsi().replace(/§[0-9;]*m/g, '');
            } else {
                try { reasonText = JSON.stringify(reason); } 
                catch (e) { reasonText = util.inspect(reason); }
            }
        }

        const cleanMessageText = reasonText.replace(/§[0-9a-fk-or]/g, '');
        if (cleanMessageText.includes('logged_in_elsewhere') || cleanMessageText.includes('duplicate_login') || cleanMessageText.includes('already connected to this proxy')) {
            isLoginElsewhere = true;
        }

        this.logger.warn(`斷線事件來源 [${source}]，原因: ${cleanMessageText}`);

        if (this.tpsMonitor) {
            this.tpsMonitor.stop();
            this.tpsMonitor = null;
        }
        this.gui = null;
        this.taskManager = null;

        if (this.client) {
            this.client.removeAllListeners();
            this.client = null;
        }
        
        this.lastKnownEffects.clear();
        this.effectsLogged = false;
        // ++ 新增 ++ 斷線時清空已處理列表
        this.processedDropEntities.clear();

        // Set context if the immediate reason is a duplicate login
        if (isLoginElsewhere) {
            this.reconnectContext = 'DUPLICATE_LOGIN';
        }

        // Always prioritize the DUPLICATE_LOGIN context for reconnection decisions
        if (this.reconnectContext === 'DUPLICATE_LOGIN') {
            if (this.config.reconnectOnDuplicateLogin && this.config.reconnectOnDuplicateLogin.enabled) {
                const delayMinutes = this.config.reconnectOnDuplicateLogin.delayMinutes;
                this.logger.warn(`處於「重複登入」的重連情境中。將在 ${delayMinutes} 分鐘後重試... (本次斷線原因: ${cleanMessageText})`);
                this.state.status = 'STOPPED';
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                }
                this.reconnectTimeout = setTimeout(() => {
                    this.reconnectTimeout = null; // Apply the stale handle fix
                    this.connect();
                }, delayMinutes * 60 * 1000);
            } else {
                this.logger.error('帳號因重複登入而斷線，且未啟用相關重連功能，將停止。');
                this.state.status = 'STOPPED';
            }
            return; // Exit after handling
        }

        // --- Standard Disconnect Logic ---
        if (cleanMessageText.includes('Authentication error')) {
            this.logger.error('帳號認證失敗！請檢查您的帳號或刪除 profiles 資料夾後重試。');
            this.state.status = 'STOPPED';
            return;
        }

        this.state.status = 'OFFLINE';
        
        if (wasOnline) {
            const QUICK_DISCONNECT_WINDOW = 60 * 1000;
            const timeSinceLogin = this.lastSuccessfulLoginTime ? Date.now() - this.lastSuccessfulLoginTime : QUICK_DISCONNECT_WINDOW;

            if (timeSinceLogin < QUICK_DISCONNECT_WINDOW) {
                this.quickDisconnectCount++;
                this.consecutiveConnectionFails++;
                this.logger.warn(`偵測到快速斷線 (登入後 ${(timeSinceLogin / 1000).toFixed(1)} 秒)，快速斷線計數: ${this.quickDisconnectCount}，連續失敗計數: ${this.consecutiveConnectionFails}`);
            } else {
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
            this.consecutiveConnectionFails++;
            this.logger.warn(`連線失敗，連續失敗次數: ${this.consecutiveConnectionFails}`);

            if (this.serverList.length > 1) {
                // ++ 重構 ++ 使用新的輪詢和黑名單機制
                const failedServer = this.serverList[this.currentServerIndex];
                const serverIdentifier = `${failedServer.host}:${failedServer.port}`;
                this.logger.warn(`將 ${serverIdentifier} 加入黑名單 ${this.BLACKLIST_COOLDOWN / 1000 / 60} 分鐘。`);
                this.ipBlacklist.set(serverIdentifier, Date.now() + this.BLACKLIST_COOLDOWN);

                if (!this._selectNextServer()) {
                    this.logger.error('所有伺服器均在黑名單中！將等待最短黑名單時間後重試。');
                    // The reconnect scheduler will handle the delay.
                }
            }
        }

        if (this.state.status !== 'STOPPED') {
            this._scheduleReconnect({ isNetworkError });
        }
    }

    /**
     * ++ 新增 ++
     * 根據黑名單選擇下一個可用的伺服器。
     * @returns {boolean} - 如果找到下一個可用的伺服器則返回 true，否則返回 false。
     */
    _selectNextServer(): boolean {
        if (this.serverList.length === 0) {
            this.logger.error('伺服器列表為空，無法選擇伺服器。');
            return false;
        }
        if (this.serverList.length === 1) {
            this.logger.info('只有一個伺服器，無需切換。');
            const serverIdentifier = `${this.serverList[0].host}:${this.serverList[0].port}`;
            const blacklistedUntil = this.ipBlacklist.get(serverIdentifier);
            if (blacklistedUntil && Date.now() < blacklistedUntil) {
                this.logger.warn(`唯一伺服器 ${serverIdentifier} 仍在黑名單中，將等待。`);
                return false;
            }
            return true;
        }

        const now = Date.now();
        let earliestBlacklistExpiry = Infinity;
        let bestCandidateIndex = -1;

        // 嘗試找到一個非黑名單的伺服器
        for (let i = 1; i <= this.serverList.length; i++) {
            const checkIndex = (this.currentServerIndex + i) % this.serverList.length;
            const server = this.serverList[checkIndex];
            const serverIdentifier = `${server.host}:${server.port}`;
            const blacklistedUntil = this.ipBlacklist.get(serverIdentifier);

            if (!blacklistedUntil || now > blacklistedUntil) {
                // 找到一個非黑名單的伺服器
                if (blacklistedUntil) {
                    this.ipBlacklist.delete(serverIdentifier); // 從黑名單中移除過期項目
                }
                this.currentServerIndex = checkIndex;
                const serverTag = this.currentServerIndex === 0 ? '主要' : `備用-${this.currentServerIndex}`;
                this.logger.info(`已切換到下一個可用伺服器: [${serverTag}] ${serverIdentifier}`);
                return true;
            } else {
                // 記錄黑名單最快過期的伺服器
                if (blacklistedUntil < earliestBlacklistExpiry) {
                    earliestBlacklistExpiry = blacklistedUntil;
                    bestCandidateIndex = checkIndex;
                }
            }
        }

        // 如果所有伺服器都在黑名單中，則選擇黑名單最快過期的伺服器
        if (bestCandidateIndex !== -1) {
            this.currentServerIndex = bestCandidateIndex;
            const server = this.serverList[bestCandidateIndex];
            const serverIdentifier = `${server.host}:${server.port}`;
            const timeLeft = Math.ceil((earliestBlacklistExpiry - now) / 1000);
            this.logger.warn(`所有伺服器均在黑名單中。已選擇黑名單最快過期的伺服器 [${serverIdentifier}]，預計 ${timeLeft} 秒後可嘗試。`);
            return false;
        }

        // 理論上不應該到達這裡，除非 serverList 為空或邏輯錯誤
        this.logger.error('無法選擇下一個伺服器，伺服器列表可能存在問題。');
        return false;
    }



    _scheduleReconnect(context: { isNetworkError?: boolean } = {}) {
        if (this.reconnectTimeout || !this.config.enabled) {
            return;
        }

        const { isNetworkError = false } = context;

        // ++ 新增 ++ 更積極的重連策略
        const AGGRESSIVE_DELAYS = [5000, 10000, 15000, 30000, 60000]; // 5s, 10s, 15s, 30s, 60s

        const QUICK_DISCONNECT_COOLDOWN = 5 * 60 * 1000;
        const SUSPENSION_DELAY = 15 * 60 * 1000;
        const LONG_TERM_WINDOW = 30 * 60 * 1000;
        const MAX_LONG_TERM_ATTEMPTS = 10;
        const MAX_QUICK_DISCONNECTS = 3;

        let delay: number;
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
            const failIndex = this.consecutiveConnectionFails - 1;
            delay = AGGRESSIVE_DELAYS[Math.min(failIndex, AGGRESSIVE_DELAYS.length - 1)];
            reason = `[積極重連] 連線失敗第 ${this.consecutiveConnectionFails} 次，將在 ${delay / 1000} 秒後重試...`;
            this.logger.warn(reason);
        }
        else {
            delay = AGGRESSIVE_DELAYS[0]; // 對於一般斷線，預設為 5 秒
            reason = `準備在 ${delay / 1000} 秒後重連...`;
            this.logger.info(reason);
        }
        
        this.reconnectAttempts.push(Date.now());
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (this.state.status !== 'STOPPED') {
                this.connect();
            } else {
                this.logger.warn(`Connect aborted in _scheduleReconnect setTimeout because status is STOPPED.`);
            }
        }, delay);
    }

    runCommand(command: string) {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('離線或未完全連接狀態，無法執行指令');
            return;
        }
        this.logger.debug(`執行指令: ${command}`);
        this.client.chat(command);
    }

    async waitForMinecartAndMount(maxDistance = 5): Promise<void> {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('機器人離線,無法執行等待礦車指令。');
            return;
        }

        const bot = this.client;
        this.logger.info(`正在等待半徑 ${maxDistance} 格內的礦車...`);

        // 1. Check for existing nearby minecart
        const nearestMinecart = bot.nearestEntity(entity => {
            return entity.name === 'minecart' && bot.entity.position.distanceTo(entity.position) <= maxDistance;
        });

        if (nearestMinecart) {
            this.logger.info(`偵測到已存在的礦車 (ID: ${nearestMinecart.id}),正在嘗試上車...`);
            try {
                await bot.mount(nearestMinecart);
                this.logger.info('✅ 成功坐上礦車。');
                return;
            } catch (err: any) {
                this.logger.error(`嘗試坐上礦車失敗: ${err.message}`);
                return;
            }
        }

        // 2. Wait for a minecart to spawn OR move into range
        return new Promise((resolve, reject) => {
            let isResolved = false;
            
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    this.logger.warn('等待礦車超時 (2分鐘)。');
                    reject(new Error('Waiting for minecart timed out after 2 minutes.'));
                }
            }, 120000);

            const cleanup = () => {
                clearTimeout(timeout);
                bot.removeListener('entitySpawn', onEntityEvent);
                bot.removeListener('entityMoved', onEntityEvent);
            };

            const onEntityEvent = async (entity: any) => {
                if (isResolved) return; // 防止重複處理
                
                if (entity.name === 'minecart' && bot.entity.position.distanceTo(entity.position) <= maxDistance) {
                    isResolved = true;
                    this.logger.info(`偵測到礦車 (ID: ${entity.id}),正在嘗試上車...`);
                    cleanup();
                    try {
                        await bot.mount(entity);
                        this.logger.info('✅ 成功坐上礦車。');
                        resolve();
                    } catch (err: any) {
                        this.logger.error(`嘗試坐上礦車失敗: ${err.message}`);
                        reject(err);
                    }
                }
            };

            bot.on('entitySpawn', onEntityEvent);
            bot.on('entityMoved', onEntityEvent);
        });
    }

    async activateLeverNearBlock(blockTypeName: string, maxDistanceToAnchor = 32, maxDistanceToLever = 5): Promise<void> {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('機器人離線，無法執行拉桿指令。');
            return;
        }

        const bot = this.client;
        const blockType = bot.registry.blocksByName[blockTypeName];

        if (!blockType) {
            this.logger.error(`未知的方塊類型: '${blockTypeName}'`);
            return;
        }

        this.logger.info(`正在尋找半徑 ${maxDistanceToAnchor} 格內的 '${blockTypeName}' 方塊...`);
        const anchorBlock = await bot.findBlock({
            matching: blockType.id,
            maxDistance: maxDistanceToAnchor
        });

        if (!anchorBlock) {
            this.logger.warn(`在附近找不到 '${blockTypeName}' 方塊。`);
            return;
        }
        this.logger.info(`找到 '${blockTypeName}' 方塊於 ${anchorBlock.position}。`);

        this.logger.info(`正在尋找 '${blockTypeName}' 附近 ${maxDistanceToLever} 格內的拉桿...`);
        const leverBlock = await bot.findBlock({
            matching: bot.registry.blocksByName.lever.id,
            maxDistance: maxDistanceToLever,
            point: anchorBlock.position
        });

        if (!leverBlock) {
            this.logger.warn(`在 '${blockTypeName}' 附近找不到拉桿。`);
            return;
        }
        this.logger.info(`找到拉桿於 ${leverBlock.position}。`);

        // Helper function to get lever state
        const getLeverState = (block: any) => {
            if (bot.supportFeature('blockStateId')) {
                return block.getProperties().powered;
            } else {
                return (block.metadata & 0x8) !== 0;
            }
        };

        const initialPoweredState = getLeverState(leverBlock);
        this.logger.info(`拉桿初始狀態: ${initialPoweredState ? '開啟' : '關閉'}`);

        try {
            await bot.activateBlock(leverBlock);
            this.logger.info('✅ 成功切換拉桿。');

            // Wait for block update to propagate
            await sleep(500); // Wait 0.5 seconds, similar to bot.waitForTicks(2)

            const updatedLeverBlock = bot.blockAt(leverBlock.position);
            if (updatedLeverBlock && updatedLeverBlock.name === 'lever') {
                const finalPoweredState = getLeverState(updatedLeverBlock);
                this.logger.info(`拉桿切換後狀態: ${finalPoweredState ? '開啟' : '關閉'}`);
            } else {
                this.logger.warn('切換後無法重新獲取拉桿方塊狀態。');
            }

        } catch (err: any) {
            this.logger.error(`切換拉桿失敗: ${err.message}`);
        }
    }

    async findAndReportLevers(radius = 10): Promise<string[]> {
        if (!this.client) {
            this.logger.warn('機器人離線，無法掃描拉桿。');
            return ['機器人離線，無法掃描拉桿。'];
        }
        const bot = this.client;

        this.logger.info(`正在掃描半徑 ${radius} 格內的拉桿...`);
        const levers = await bot.findBlocks({
            matching: bot.registry.blocksByName.lever.id,
            maxDistance: radius,
            count: 20 // Limit to 20 levers
        });

        if (levers.length === 0) {
            this.lastScannedLevers = [];
            return ["附近沒有找到任何拉桿。সহায়তা"];
        }

        this.lastScannedLevers = []; // Clear previous scan
        const reportLines: string[] = [];

        for (const leverPos of levers) {
            const leverBlock = bot.blockAt(leverPos);
            if (!leverBlock) continue;

            const isPowered = (bot.supportFeature('blockStateId'))
                ? leverBlock.getProperties().powered
                : (leverBlock.metadata & 0x8) !== 0;
            const stateStr = isPowered ? '開啟' : '關閉';

            this.lastScannedLevers.push(leverBlock);
            const index = this.lastScannedLevers.length;

            reportLines.push(`[${index}] 拉桿於 (${leverBlock.position.x}, ${leverBlock.position.y}, ${leverBlock.position.z}) - 狀態: ${stateStr}`);
        }

        return reportLines;
    }

    async activateLeverByIndex(index: number): Promise<void> {
        if (!this.client) {
            this.logger.warn('機器人離線，無法啟動拉桿。');
            return;
        }

        const leverIndex = index - 1; // User sees 1-based, array is 0-based
        if (leverIndex < 0 || leverIndex >= this.lastScannedLevers.length) {
            this.logger.error(`無效的拉桿編號: ${index}。請先執行 'lever' 指令掃描。`);
            return;
        }

        const leverBlock = this.lastScannedLevers[leverIndex];
        this.logger.info(`正在啟動編號 ${index} 的拉桿於 ${leverBlock.position}...`);
        
        // Reuse the state checking logic
        const bot = this.client;
        const getLeverState = (block: any) => {
            if (bot.supportFeature('blockStateId')) {
                return block.getProperties().powered;
            } else {
                return (block.metadata & 0x8) !== 0;
            }
        };

        const initialPoweredState = getLeverState(leverBlock);
        this.logger.info(`拉桿初始狀態: ${initialPoweredState ? '開啟' : '關閉'}`);

        try {
            await bot.activateBlock(leverBlock);
            this.logger.info('✅ 成功切換拉桿。');

            await sleep(500);

            const updatedLeverBlock = bot.blockAt(leverBlock.position);
            if (updatedLeverBlock && updatedLeverBlock.name === 'lever') {
                const finalPoweredState = getLeverState(updatedLeverBlock);
                this.logger.info(`拉桿切換後狀態: ${finalPoweredState ? '開啟' : '關閉'}`);
            } else {
                this.logger.warn('切換後無法重新獲取拉桿方塊狀態。');
            }
        } catch (err: any) {
            this.logger.error(`切換拉桿失敗: ${err.message}`);
        }
    }

    displayExperience() {
        if (this.state.status !== 'ONLINE' || !this.client) {
            this.logger.warn('機器人離線，無法獲取經驗值資訊。');
            return;
        }
        const exp = this.client.experience;
        let hourlyInfo = '數據不足，無法計算';
        let durationStr = '00h 00m 00s';

        if (this.expSamplesHour.length >= 1) { // 只需要一個樣本點作為起點
            const oldest = this.expSamplesHour[0];
            const newest = { time: Date.now(), points: this.client.experience.points }; // 當前狀態作為終点
            const timeDiffMs = newest.time - oldest.time;

            if (timeDiffMs > 0) {
                const totalExpGained = newest.points - oldest.points;
                const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
                const avgExpPerHour = totalExpGained / timeDiffHours;

                const hours = Math.floor(timeDiffHours);
                const minutes = Math.floor((timeDiffHours * 60) % 60);
                const seconds = Math.floor((timeDiffHours * 3600) % 60);
                durationStr = `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

                hourlyInfo = `總獲得: ${totalExpGained.toLocaleString()} / 平均: ${avgExpPerHour.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} exp/h`;
            }
        }

        this.logger.info(`--- [經驗值資訊] ---
` +
            `  當前狀態: 等級 ${exp.level} / 總點數 ${exp.points.toLocaleString()} / 進度 ${(exp.progress * 100).toFixed(2)}%
` +
            `  長期統計 (${durationStr}): ${hourlyInfo}
` +
            `--------------------`);
    }

    toggleExpLogging() {
        this.logExpRate = !this.logExpRate;
        this.logger.info(`經驗值/小時 日誌已 ${this.logExpRate ? '開啟' : '關閉'}。`);
    }
}