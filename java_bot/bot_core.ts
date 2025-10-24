import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as util from 'util';
import { ChatMessage } from 'prismarine-chat';
import mineflayer, { BotOptions } from 'mineflayer';
import tpsPlugin from 'mineflayer-tps';

interface CustomBotOptions extends BotOptions {
    botTag: string;
    host: string;
    port: number;
    username: string;
    enabled?: boolean;
    enableViewer?: boolean;
    viewerPort?: number;
    startWorkOnLogin?: boolean;
    enableItemDropDetection?: boolean;
            antiAfk?: {
                enabled: boolean;
                intervalMinutes: number;
            };
            reconnectOnDuplicateLogin?: {
                enabled: boolean;
                delayMinutes: number;
            };
        }
// =================================================================================
// 1. UTILITIES (工具函式庫)
// =================================================================================

const Colors = {
    Reset: "\x1b[0m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m", FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m"
};

const logger = (() => {
    let rlInterface: readline.Interface | null = null;
    let activeBotForLogging: any = null;
    const LogLevel: { [key: string]: number } = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CHAT: 4 };

    const log = (level: number, ...args: any[]) => {
        if (level === LogLevel.DEBUG) {
            // If a bot is active, respect its setting. Otherwise, check the env var as a fallback for non-bot logs.
            if (activeBotForLogging && !activeBotForLogging.config.debugMode) return;
            if (!activeBotForLogging && !process.env.DEBUG) return;
        }
        const isChat = level === LogLevel.CHAT;

        const levelMap: { [key: number]: string } = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
        const levelColorMap: { [key: number]: string } = { 0: Colors.FgMagenta, 1: Colors.FgGreen, 2: Colors.FgYellow, 3: Colors.FgRed, 4: Colors.Reset };

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
        setRl: (rl: readline.Interface) => { rlInterface = rl; },
        unsetRl: () => { rlInterface = null; },
        setActiveBot: (bot: any) => { activeBotForLogging = bot; },
        debug: (...args: any[]) => log(LogLevel.DEBUG, ...args),
        info: (...args: any[]) => log(LogLevel.INFO, ...args),
        warn: (...args: any[]) => log(LogLevel.WARN, ...args),
        error: (...args: any[]) => log(LogLevel.ERROR, ...args),
        chat: (...args: any[]) => log(LogLevel.CHAT, ...args),
        Colors: Colors
    };
})();

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

class TPSMonitor {
    bot: any;
    packetTpsValues: number[];
    lastPacketTime: number;
    tickTimes: number[];
    lastTickTime: number;
    physicsTPS: number;
    tpsHistory: number[];
    lastGameTime: bigint;
    lastRealTime: number;
    gameTimeInterval: NodeJS.Timeout | null;

    constructor(bot: mineflayer.Bot) {
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
        this.lastGameTime = 0n;
        this.lastRealTime = Date.now();
        this.gameTimeInterval = null;
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
        return this.packetTpsValues.reduce((a: number, b: number) => a + b) / this.packetTpsValues.length;
    }

    // --- Physics Tick Logic ---
    onPhysicsTick() {
        const now = Date.now();
        const deltaTime = now - this.lastTickTime;
        this.tickTimes.push(deltaTime);
        if (this.tickTimes.length > 100) this.tickTimes.shift();
        if (this.tickTimes.length >= 20) {
            const avgDeltaTime = this.tickTimes.reduce((a: number, b: number) => a + b) / this.tickTimes.length;
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
        if (!this.bot.time || !this.bot.time.bigTime || this.lastGameTime === null) return;

        const currentGameTime = this.bot.time.bigTime;
        const currentRealTime = Date.now();
        const gameTimeDiff = Number(BigInt(currentGameTime) - BigInt(this.lastGameTime));
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
        return this.tpsHistory.reduce((a: number, b: number) => a + b) / this.tpsHistory.length;
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

import { GuiManager } from './src/gui.js';

import { TaskManager } from './src/taskManager.js';

class BotJava {
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
    lastSuccessfulLoginTime: number | null;
    quickDisconnectCount: number;
    consecutiveConnectionFails: number;
    isDisconnecting: boolean;
    isGuiBusy: boolean;
    connectionGlitchHandled: boolean;
    tpsMonitor: TPSMonitor | null;
    ominousTrialKeyDrops: number;
    processedDropEntities: Set<number>;
    logger: any;

    constructor(botConfig: CustomBotOptions) {
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
            }
        };
        this.config = { ...defaultConfig, ...botConfig };
        // Deep merge for nested antiAfk object to ensure defaults are kept
        if (botConfig && botConfig.antiAfk) {
            this.config.antiAfk = { ...defaultConfig.antiAfk, ...botConfig.antiAfk };
        }
        if (botConfig && botConfig.reconnectOnDuplicateLogin) {
            this.config.reconnectOnDuplicateLogin = { ...defaultConfig.reconnectOnDuplicateLogin, ...botConfig.reconnectOnDuplicateLogin };
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
            const { auctionHouseTask, playerWarpTask } = await import('./src/tasks.js');
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
            } else {
                this.logger.debug('[工作循環] 機器人非線上狀態，跳過本次操作檢查。');
            }
        } catch (error: any) {
            this.logger.error(`在工作循環中發生錯誤: ${error.message}`);
        } finally {
            if (this.isWorking) {
                this.workTimeout = setTimeout(() => this._maintainOmenEffect(), OMEN_CHECK_INTERVAL);
            }
        }
    }

    _setupEventListeners() {
        if (!this.client) return;

        this.client.on('login', () => {
            if (!this.client) return;
            this.state.status = 'ONLINE';
            this.logger.info(`✅ 成功登入到 ${this.config.host}:${this.config.port}，玩家名稱: ${this.client.username}`);
            this.lastSuccessfulLoginTime = Date.now();
            this.consecutiveConnectionFails = 0;
            this.reconnectContext = 'NONE'; // Reset context on successful login
            this.connectionGlitchHandled = false;

            if (this.tpsMonitor) {
                this.tpsMonitor.start();
            }

            if (this.config.antiAfk.enabled) {
                if (this.antiAfkInterval) clearInterval(this.antiAfkInterval);
                this.antiAfkInterval = setInterval(async () => {
                    if (!this.client || this.isGuiBusy) {
                        if (this.isGuiBusy) this.logger.info('[Anti-AFK] 偵測到介面正在使用中，跳過本次操作。');
                        return;
                    }
            
                    this.isGuiBusy = true;
                    this.logger.info('[Anti-AFK] 執行開啟並關閉 /ah 來重置計時器...');
                    try {
                        this.client.chat('/ah');
                        const window: any = await new Promise((resolve, reject) => {
                            const timer = setTimeout(() => {
                                if (this.client) this.client.removeListener('windowOpen', onWindowOpen);
                                reject(new Error('等待 /ah 視窗開啟超時 (10秒)'));
                            }, 10000);
                    
                            const onWindowOpen = (win: any) => {
                                clearTimeout(timer);
                                if (this.client) this.client.removeListener('windowOpen', onWindowOpen);
                                resolve(win);
                            };
                    
                            if (this.client) {
                                this.client.on('windowOpen', onWindowOpen);
                            } else {
                                clearTimeout(timer);
                                reject(new Error('客戶端在等待視窗時斷線'));
                            }
                        });

                        await sleep(1000); // Wait a second before closing
                        window.close();
                        this.logger.info('[Anti-AFK] /ah 介面已成功關閉。');
                    } catch (err: any) {
                        this.logger.error(`[Anti-AFK] 操作失敗: ${err.message}`);
                        // If an error occurs, it's possible a window is stuck open.
                        if (this.client.currentWindow) {
                            try { this.client.closeWindow(this.client.currentWindow); } catch {}
                        }
                    } finally {
                        this.isGuiBusy = false;
                    }
                }, this.config.antiAfk.intervalMinutes * 60 * 1000);
                this.logger.info(`Anti-AFK 功能已更新為執行 /ah 指令，每 ${this.config.antiAfk.intervalMinutes} 分鐘執行一次。`);
            }
        });

        this.client.on('spawn', async () => {
            if (!this.client) return;
            this.logger.info('機器人已在遊戲世界中生成。');

            // Start work mode after spawning to ensure inventory is loaded
            if (this.config.startWorkOnLogin && !this.isWorking) {
                this.startWork();
            }
            await sleep(2000);
            if (this.client) {
                this.logger.info(`目前位置: ${this.client.entity.position}`);
            }
            if (this.config.enableViewer) {
                // Dynamically import viewer dependencies only when needed
                try {
                    const viewerModule = (await import('prismarine-viewer')).mineflayer;
                    const { Canvas } = await import('canvas');
                    await this.startViewer(viewerModule, { Canvas });
                } catch (e: any) {
                    this.logger.error(`無法加載監看視窗模組: ${e.message}`);
                    this.logger.warn('請執行 "npm install prismarine-viewer canvas" 來安裝監看視窗的依賴。');
                    this.config.enableViewer = false;
                }
            }
        });

        this.client.on('entityEffect', async (entity: any, effect: any) => {
            const client = this.client;
            if (!client) return;
            if (entity === client.entity) {
                const mcDataFactory = (await import('minecraft-data')).default;
                const mcData = mcDataFactory(client.version);
                const effectName = Object.keys(mcData.effectsByName).find(name =>
                    mcData.effectsByName[name].id === effect.id
                );

                const previousEffect = this.lastKnownEffects.get(effect.id);
                if (!previousEffect || previousEffect.amplifier !== effect.amplifier) {
                    const action = !previousEffect ? "獲得" :
                        effect.amplifier > previousEffect.amplifier ? "等級提升為" :
                            effect.amplifier < previousEffect.amplifier ? "等級變為" : "等級變為";
                    const name = effectName || `未知效果 (ID: ${effect.id})`;

                    this.logger.info(`[狀態更新] ${action}效果: ${name} (等級: ${effect.amplifier + 1})`);
                }

                this.lastKnownEffects.set(effect.id, { id: effect.id, amplifier: effect.amplifier });
            }
        });
        
        this.client.on('entityEffectEnd', async (entity: any, effect: any) => {
            const client = this.client;
            if (!client) return;
            if (entity === client.entity && this.lastKnownEffects.has(effect.id)) {
                const mcDataFactory = (await import('minecraft-data')).default;
                const mcData = mcDataFactory(client.version);
                const effectName = Object.keys(mcData.effectsByName).find(name =>
                    mcData.effectsByName[name].id === effect.id
                );
                const name = effectName || `未知效果 (ID: ${effect.id})`;
                this.logger.info(`[狀態更新] 效果已結束: ${name}`);

                this.lastKnownEffects.delete(effect.id);
                
                if (this.isWorking && ['TrialOmen', 'BadOmen'].includes(effectName as string)) {
                    this.logger.info('偵測到 Omen 效果結束，立即安排一次快速檢查...');
                    
                    if (this.workTimeout) clearTimeout(this.workTimeout);
                    
                    this.workTimeout = setTimeout(() => this._maintainOmenEffect(), OMEN_REAPPLY_DELAY);
                }
            }
        });

        this.client.on('itemDrop', (entity: any) => {
            const client = this.client;
            if (!client || !this.config.enableItemDropDetection) return;
            if (!entity || !entity.metadata) return;

            // ++ 修改 ++ 檢查此掉落物實體是否已被處理
            if (this.processedDropEntities.has(entity.id)) {
                this.logger.debug(`[掉落物] 忽略已處理的掉落物實體: ${entity.id}`);
                return;
            }
            
            //this.logger.info(`🎯 itemDrop 事件觸發！實體ID: ${entity.id}, 名稱: ${entity.name}`);
            if (this.config.debugMode) {
                 this.logger.debug(`完整 metadata: ${util.inspect(entity.metadata, { depth: null })}`);
            }

            try {
                let itemData: any;
                let slotPosition: number;

                // ++ 修改 ++ 根據日誌和版本特性，更精準地判斷 slot 位置
                if (client.supportFeature('itemsAreAlsoBlocks')) { // < 1.13
                    slotPosition = 6;
                } else { // >= 1.13
                    const majorVersion = parseInt(client.version.split('.')[1]);
                    if (client.majorVersion === '1.13') {
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
                        if (value && ((value as any).itemId !== undefined || (value as any).blockId !== undefined)) {
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

                const item = client.registry.items[itemId];
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

            } catch (error: any) {
                this.logger.error(`處理掉落物時發生錯誤: ${error.message}`);
                this.logger.debug(error.stack);
            }
        });

        this.client.on('entityGone', (entity: any) => {
            // ++ 新增 ++ 當掉落物實體消失時，從集合中移除，釋放記憶體
            if (this.processedDropEntities.has(entity.id)) {
                this.processedDropEntities.delete(entity.id);
                this.logger.debug(`[掉落物] 已從追蹤列表中移除實體: ${entity.id}`);
            }
        });

        this.client.on('entitySpawn', (entity: any) => {
            if (this.config.debugMode && entity.name && (entity.name.toLowerCase() === 'item' || entity.name.toLowerCase() === 'item_stack')) {
                this.logger.info(`🔍 偵測到掉落物實體生成 (名稱: ${entity.name}, ID: ${entity.id})`);
                this.logger.debug(`[掉落物偵錯-SPAWN] 實體位於 ${entity.position.floored()}`);
            }
        });

        this.client.on('message', (jsonMsg: ChatMessage, position: string) => {
            if (!this.client) return;
            try {
                const messageText = jsonMsg.toString();

                if (
                    (jsonMsg as any).color === 'red' &&
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
                        (global as any).takeItemFromWindow(this, '/atm', '虛擬銀行 (ATM)', 9);
                    }, 1500);
                }

                this.logger.chat(jsonMsg.toAnsi());
            } catch (error: any) {
                this.logger.warn('攔截到一個可忽略的聊天封包解析錯誤，已忽略以維持連線穩定。');
                this.logger.debug(`錯誤詳情: ${error.message}`);
            }
        });

        this.client.on('kicked', (reason: string, _loggedIn: boolean) => this._onDisconnected('kicked', reason));
        this.client.on('error', (err: Error) => this._onDisconnected('error', err));
        this.client.on('end', (reason: string) => this._onDisconnected('end', reason));
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
                reasonText = (reason as any).toAnsi().replace(/\u001b\[[0-9;]*m/g, '');
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

    _scheduleReconnect(context: { isNetworkError?: boolean } = {}) {
        if (this.reconnectTimeout || !this.config.enabled) {
            return;
        }

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
}

export { BotJava, TPSMonitor, logger, sleep, Colors };