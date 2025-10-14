const fs = require('fs');
const path = require('path');
const { BotJava, logger, sleep } = require('./bot_core.js');
const { startConsole } = require('./console.js');

// =================================================================================
// 4. MAIN EXECUTION (主程式入口)
// =================================================================================

async function main() {
    process.on('uncaughtException', (err, origin) => {
        logger.unsetRl();
        console.error('\n==================== UNCAUGHT EXCEPTION ====================\n');
        console.error('捕獲到未處理的頂層異常！這是一個嚴重錯誤，可能導致程式不穩定。');
        console.error(`來源 (Origin): ${origin}`);
        console.error(err);
        console.error('============================================================');
    });
    process.on('unhandledRejection', (reason, promise) => {
        logger.unsetRl();
        console.error('\n==================== UNHANDLED REJECTION ====================\n');
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