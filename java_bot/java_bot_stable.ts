import * as fs from 'fs';
import * as path from 'path';
import { BotJava } from './src/bot.js';
import { logger, sleep } from './src/utils.js';
import { startConsole } from './src/cli.js';

// (global as any).takeItemFromWindow = takeItemFromWindow;

// =================================================================================
// 4. MAIN EXECUTION (主程式入口)
// =================================================================================

async function main() {
    process.on('uncaughtException', (err: Error, origin: string) => {
        logger.unsetRl();
        console.error('\n==================== UNCAUGHT EXCEPTION ====================\n');
        console.error('捕獲到未處理的頂層異常！這是一個嚴重錯誤，可能導致程式不穩定。');
        console.error(`來源 (Origin): ${origin}`);
        console.error(err);
        console.error('============================================================');
    });
    process.on('unhandledRejection', (reason: any, _promise: any) => {
        logger.unsetRl();
        console.error('\n==================== UNHANDLED REJECTION ====================\n');
        console.error('捕獲到未處理的 Promise Rejection！');
        console.error('原因 (Reason):', reason);
        console.error('=============================================================');
    });

    if (!fs.existsSync(path.join(__dirname, '..', 'config'))) fs.mkdirSync(path.join(__dirname, '..', 'config'));
    if (!fs.existsSync(path.join(__dirname, '..', 'profiles'))) fs.mkdirSync(path.join(__dirname, '..', 'profiles'));

    let configFileName: string;

    if (process.env.NODE_ENV === 'test') {
        configFileName = 'accounts_java_test.json';
    } else {
        configFileName = 'accounts_java_stable.json';
    }

    const accountsPath = path.join(__dirname, '..', 'config', configFileName);
    logger.info(`正在讀取設定檔: ${configFileName}`);

    if (!fs.existsSync(accountsPath)) {
        logger.error(`錯誤: 找不到設定檔！ (${path.join('config', configFileName)})`);
        logger.error(`請將 ${configFileName}.example (如果有的話) 複製為 ${configFileName} 並填寫您的帳號資訊。`);
        process.exit(1);
    }

    const serversPath = path.join(__dirname, '..', 'config', 'servers.json');
    if (!fs.existsSync(serversPath)) {
        logger.error(`錯誤: 找不到伺服器設定檔！ (config/servers.json)`);
        process.exit(1);
    }

    const servers = JSON.parse(fs.readFileSync(serversPath, 'utf-8'));
    logger.info('已成功讀取伺服器設定檔。');

    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    const botManager = new Map<string, BotJava>();
    const botTagsByIndex: string[] = [];

    const isAnyViewerEnabled = accounts.some((acc: any) => acc.enabled && acc.enableViewer);

    if (isAnyViewerEnabled) {
        logger.info('偵測到監看功能已啟用。相關模組將在機器人生成時動態載入。');
    }

    let nextViewerPort = 3000;
    for (const config of accounts) {
        if (!config.botTag) {
            logger.warn('發現一個沒有 botTag 的帳號設定，已跳過。');
            continue;
        }

        const serverName = config.server;
        const serverInfo = servers[serverName];

        if (!serverInfo) {
            logger.error(`[設定錯誤] 機器人 ${config.botTag} 指定的伺服器 '${serverName}' 在 servers.json 中找不到，已跳過。`);
            continue;
        }

        const serverList = [serverInfo.primary, ...(serverInfo.backups || [])].filter(s => s && s.host && s.port);
        if (serverList.length === 0) {
            logger.error(`[設定錯誤] 伺服器 '${serverName}' 沒有設定任何有效的 primary 或 backup IP，已跳過機器人 ${config.botTag}。`);
            continue;
        }

        if (config.enabled && config.enableViewer) {
            config.viewerPort = nextViewerPort;
            logger.info(`為 ${config.botTag} 分配監看埠: ${config.viewerPort}`);
            nextViewerPort++;
        } else {
            config.enableViewer = false;
        }

        botManager.set(config.botTag, new BotJava(config, serverList));
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