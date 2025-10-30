const { logger, sleep, Colors } = require('./utils.js');

class QueueProcessor {
    constructor(name, timeout) {
        this.name = name;
        this.queue = [];
        this.isProcessing = false;
        this.isShuttingDown = false;
        this.timeout = timeout;
    }

    addTask(bot, task, description) {
        this.queue.push({ bot, task, description });
        bot.logger.debug(`[${this.name}隊列] 新增任務: "${description}" (尚有 ${this.queue.length} 個)`);
    }

    async processQueue() {
        while (!this.isShuttingDown) {
            if (this.isProcessing || this.queue.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            this.isProcessing = true;
            const { bot, task, description } = this.queue.shift();

            bot.logger.debug(`[${this.name}隊列] 開始執行任務: "${description}" (剩餘 ${this.queue.length} 個)`);

            try {
                await task();
            } catch (error) {
                bot.logger.error(`[${this.name}隊列] 任務 "${description}" 執行失敗: ${error.message}`);
            } finally {
                bot.logger.debug(`[${this.name}隊列] 任務 "${description}" 執行完畢，釋放鎖。`);
                this.isProcessing = false;
            }
        }
    }

    start() {
        this.processQueue();
    }

    setShutdown() {
        this.isShuttingDown = true;
    }
    
    getQueue() {
        return this.queue;
    }

    async waitForCompletion(timeout) {
        if (this.queue.length === 0 && !this.isProcessing) {
            console.log(`${Colors.FgGreen}✓ ${this.name} 任務隊列是空的，無需等待。${Colors.Reset}`);
            return;
        }

        console.log(`正在等待 ${this.queue.length + (this.isProcessing ? 1 : 0)} 個 ${this.name} 任務執行完畢...`);

        const waitPromise = (async () => {
            while (this.queue.length > 0 || this.isProcessing) {
                await sleep(1000);
            }
        })();

        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), timeout));

        const result = await Promise.race([waitPromise, timeoutPromise]);

        if (result === 'timeout') {
            console.log(`${Colors.FgRed}✗ 等待 ${this.name} 任務隊列超时 (${timeout / 1000}秒)，強制繼續... ${Colors.Reset}`);
        } else {
            console.log(`${Colors.FgGreen}✓ ${this.name} 任務隊列已清空。${Colors.Reset}`);
        }
    }
}

module.exports = {
    QueueProcessor
};
