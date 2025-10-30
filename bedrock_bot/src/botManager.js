const fs = require('fs');
const path = require('path');
const Bot = require('./bot.js');
const { logger, sleep, Colors } = require('./utils.js');

class BotManager {
    constructor(itemMapping) {
        this.bots = new Map();
        this.botTagsByIndex = [];
        this.itemMapping = itemMapping;
    }

    loadAccounts(accountsPath) {
        if (!fs.existsSync(accountsPath)) {
            logger.error(`設定檔未找到: ${accountsPath}`);
            process.exit(1);
        }

        const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
        for (const config of accounts) {
            if (!config.botTag) {
                logger.warn('發現沒有 botTag 的機器人設定，已略過。');
                continue;
            }
            const bot = new Bot(config, this.itemMapping);
            this.bots.set(config.botTag, bot);
            this.botTagsByIndex.push(config.botTag);
        }
        logger.info(`從 ${path.basename(accountsPath)} 載入 ${this.bots.size} 個機器人`);
    }

    async connectEnabledBots() {
        const enabledBots = this.getEnabledBots();
        if (enabledBots.length > 0) {
            const CONNECT_INTERVAL = 6000;
            logger.info(`發現 ${enabledBots.length} 個啟用的機器人，開始連線程序...`);
            for (const bot of enabledBots) {
                bot.connect();
                await sleep(CONNECT_INTERVAL);
            }
        }
    }

    getBot(identifier) {
        const index = parseInt(identifier, 10);
        if (!isNaN(index) && index > 0 && index <= this.botTagsByIndex.length) {
            const botTag = this.botTagsByIndex[index - 1];
            return this.bots.get(botTag);
        }
        return this.bots.get(identifier);
    }

    getAllBots() {
        return Array.from(this.bots.values());
    }

    getEnabledBots() {
        return this.getAllBots().filter(bot => bot.config.enabled);
    }

    getBotTagsByIndex() {
        return this.botTagsByIndex;
    }

    async shutdown() {
        logger.info('開始平穩關機...');

        const SHUTDOWN_TIMEOUT = 30000; // 30 seconds
        for (const bot of this.getAllBots()) {
            if (bot.uiQueue) {
                bot.uiQueue.setShutdown();
                await bot.uiQueue.waitForCompletion(SHUTDOWN_TIMEOUT);
            }
        }
        logger.info(`${Colors.FgGreen}所有機器人隊列已處理完畢。${Colors.Reset}`);

        logger.info('正在斷開所有機器人連線...');
        this.getAllBots().forEach(bot => bot.disconnect('Server shutdown'));
        await sleep(500);
        logger.info(`${Colors.FgGreen}All bots have been disconnected.${Colors.Reset}`);
    }
}

module.exports = { BotManager };