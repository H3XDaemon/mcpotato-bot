const fs = require('fs');
const path = require('path');
const { BotManager } = require('./src/botManager.js');
const { startConsole } = require('./src/console.js');
const { logger, sleep, Colors, setAppShutdown } = require('./src/utils.js');

async function main() {
    // [關鍵修正] 讀取並解析 Geyser 的 runtimeId 映射檔案
    const RUNTIME_ID_FILENAME = 'runtime_item_states.1_21_110.json';
    const runtimeIdPath = path.join(__dirname, 'config', RUNTIME_ID_FILENAME);
    let itemMapping = new Map();

    if (fs.existsSync(runtimeIdPath)) {
        logger.info('正在讀取 Geyser runtimeId 映射檔案...');
        const runtimeIdData = JSON.parse(fs.readFileSync(runtimeIdPath, 'utf-8'));
        for (const item of runtimeIdData) {
            itemMapping.set(item.id, item.name);
        }
        logger.info(`成功載入 ${itemMapping.size} 個物品 ID 映射。`);
    } else {
        logger.error(`錯誤: 找不到 runtimeId 映射檔案！ (${runtimeIdPath})`);
        process.exit(1);
    }

    const tpaWhitelistPath = path.join(__dirname, 'config', 'tpa_whitelist.json');
    let tpaWhitelist = [];
    if (fs.existsSync(tpaWhitelistPath)) {
        try {
            tpaWhitelist = JSON.parse(fs.readFileSync(tpaWhitelistPath, 'utf-8'));
            logger.info(`成功載入 ${tpaWhitelist.length} 個 TPA 白名單玩家。`);
        } catch (error) {
            logger.error(`讀取或解析 TPA 白名單時發生錯誤: ${error.message}`);
        }
    } else {
        logger.warn(`未找到 TPA 白名單檔案 (${tpaWhitelistPath})，將不會啟用自動同意功能。`);
    }

    const botManager = new BotManager(itemMapping, tpaWhitelist);
    const accountsPath = path.join(__dirname, 'config', 'accounts.json');
    botManager.loadAccounts(accountsPath);
    botManager.connectEnabledBots();

    const rl = startConsole(botManager);

    rl.on('close', async () => {
        setAppShutdown();
        console.log(`\n\n${Colors.FgYellow}--- 開始執行優雅關閉程序 ---${Colors.Reset}`);
        console.log('將不再接受新的指令，並等待現有任務完成...');
        rl.pause();

        await botManager.shutdown();

        console.log(`${Colors.FgYellow}--- 優雅關閉完成，程式即將退出 ---${Colors.Reset}`);
        process.exit(0);
    });
}

// --- 全域錯誤處理 ---
process.on('uncaughtException', (err, origin) => {
    logger.error('捕獲到未處理的異常:', err, '來源:', origin);
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('捕獲到未處理的 Promise Rejection:', reason);
});

main().catch(err => {
    console.error('主程式發生致命錯誤:', err);
    process.exit(1);
});
