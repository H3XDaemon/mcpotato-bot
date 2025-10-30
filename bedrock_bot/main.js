const fs = require('fs');
const path = require('path');
const Bot = require('./src/bot.js');
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
        setAppShutdown();
        console.log(`\n\n${Colors.FgYellow}--- 開始執行優雅關閉程序 ---${Colors.Reset}`);
        console.log('將不再接受新的指令，並等待現有任務完成...');
        rl.pause();

        const waitForQueue = async (queue, name, timeout) => {
            const queueInstance = queue.getQueue();
            if (queueInstance.length === 0 && !queue.isProcessing) {
                console.log(`${Colors.FgGreen}✓ ${name} 任務隊列是空的，無需等待。${Colors.Reset}`);
                return;
            }

            console.log(`正在等待 ${queueInstance.length + (queue.isProcessing ? 1 : 0)} 個 ${name} 任務執行完畢...`);

            const waitPromise = (async () => {
                while (queueInstance.length > 0 || queue.isProcessing) {
                    await sleep(1000);
                }
            })();

            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), timeout));

            const result = await Promise.race([waitPromise, timeoutPromise]);

            if (result === 'timeout') {
                console.log(`${Colors.FgRed}✗ 等待 ${name} 任務隊列超时 (${timeout / 1000}秒)，強制繼續... ${Colors.Reset}`);
            } else {
                console.log(`${Colors.FgGreen}✓ ${name} 任務隊列已清空。${Colors.Reset}`);
            }
        };

        console.log('正在依序關閉所有機器人任務隊列...');
        const SHUTDOWN_TIMEOUT = 30000; // 每個隊列最多等待 30 秒
        for (const bot of botManager.values()) {
            if (bot.uiQueue) {
                bot.uiQueue.setShutdown();
                await waitForQueue(bot.uiQueue, bot.config.botTag, SHUTDOWN_TIMEOUT);
            }
        }
        console.log(`${Colors.FgGreen}✓ 所有機器人任務隊列已清空或超時。${Colors.Reset}`);

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
    logger.error('捕獲到未處理的異常:', err, '來源:', origin);
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('捕獲到未處理的 Promise Rejection:', reason);
});

main().catch(err => {
    console.error('主程式發生致命錯誤:', err);
    process.exit(1);
});
