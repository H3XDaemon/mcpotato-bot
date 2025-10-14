const fs = require('fs');
const path = require('path');
const Bot = require('./src/bot.js');
const { startConsole } = require('./src/console.js');
const { logger, sleep, Colors } = require('./src/utils.js');
const atm = require('./src/atm.js');
const home = require('./src/home.js');

async function main() {
    // [關鍵修正] 讀取並解析 Geyser 的 runtimeId 映射檔案
    const runtimeIdPath = path.join(__dirname, 'config', 'runtime_item_states.1_21_93.json');
    let itemMapping = new Map();

    if (fs.existsSync(runtimeIdPath)) {
        logger.info('正在讀取 Geyser runtimeId 映射檔案...');
        const runtimeIdData = JSON.parse(fs.readFileSync(runtimeIdPath, 'utf-8'));
        for (const item of runtimeIdData) {
            itemMapping.set(item.id, item.name);
        }
        logger.info(`成功載入 ${itemMapping.size} 個物品 ID 映射。`);
    } else {
        logger.error(`錯誤: 找不到 runtimeId 映射檔案！ (${path.join('config', 'runtime_item_states.1_21_93.json')})`);
        logger.error('請將 Geyser 的 runtime_item_states.json 檔案複製到 config 資料夾中。');
        process.exit(1);
    }

    // 啟動所有任務隊列處理器
    atm.startQueueProcessor();
    home.startQueueProcessor();

    // 讀取帳號設定檔
    const configFileName = 'accounts.json';
    const accountsPath = path.join(__dirname, 'config', configFileName);
    logger.info(`正在讀取設定檔: ${configFileName}`);

    if (!fs.existsSync(accountsPath)) {
        logger.error(`錯誤: 找不到設定檔！ (${path.join('config', configFileName)})`);
        logger.error('請確認 config/accounts.json 檔案存在。');
        process.exit(1);
    }

    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    const botManager = new Map();
    const botTagsByIndex = [];

    for (const config of accounts) {
        if (!config.botTag) {
            logger.warn('發現一個沒有 botTag 的帳號設定，已跳過。');
            continue;
        }
        // [關鍵修正] 將映射表傳遞給 Bot 的建構函式
        botManager.set(config.botTag, new Bot(config, itemMapping));
        botTagsByIndex.push(config.botTag);
    }
    logger.info(`已從 ${configFileName} 載入 ${botManager.size} 個帳號設定。`);

    const enabledAccounts = Array.from(botManager.values()).filter(bot => bot.config.enabled);
    if (enabledAccounts.length > 0) {
        const CONNECT_INTERVAL = 6000;
        logger.info(`找到 ${enabledAccounts.length} 個已啟用的帳號，準備自動連線...`);
        for (const bot of enabledAccounts) {
            bot.connect();
            await sleep(CONNECT_INTERVAL);
        }
    }

    const rl = startConsole(botManager, botTagsByIndex);

    rl.on('close', async () => {
        atm.setShutdown();
        console.log(`\n\n${Colors.FgYellow}--- 開始執行優雅關閉程序 ---${Colors.Reset}`);
        console.log('將不再接受新的指令，並等待現有任務完成...');
        rl.pause();

        const waitForQueue = async (queue, processingFlag, name) => {
            if (queue.length > 0 || processingFlag) {
                console.log(`正在等待 ${queue.length + (processingFlag ? 1 : 0)} 個 ${name} 任務執行完畢...`);
                while(queue.length > 0 || processingFlag) {
                    await sleep(1000);
                }
                console.log(`${Colors.FgGreen}✓ ${name} 任務隊列已清空。${Colors.Reset}`);
            } else {
                console.log(`${Colors.FgGreen}✓ ${name} 任務隊列是空的，無需等待。${Colors.Reset}`);
            }
        };

        await waitForQueue(atm.atmQueue, atm.isAtmProcessing, 'ATM');
        await waitForQueue(home.homeQueue, home.isHomeProcessing, 'Home');

        console.log('正在斷開所有機器人連線...');
        botManager.forEach(bot => bot.disconnect('程式關閉'));
        await sleep(500);
        console.log(`${Colors.FgGreen}✓ 所有機器人已斷線。${Colors.Reset}`);

        console.log(`${Colors.FgYellow}--- 優雅關閉完成，程式即將退出 ---${Colors.Reset}`);
        process.exit(0);
    });
}

// --- 全域錯誤處理 ---
process.on('uncaughtException', (err, origin) => {
    console.error('捕獲到未處理的異常:', err, '來源:', origin);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('捕獲到未處理的 Promise Rejection:', reason);
});

main().catch(err => {
    console.error('主程式發生致命錯誤:', err);
    process.exit(1);
});
