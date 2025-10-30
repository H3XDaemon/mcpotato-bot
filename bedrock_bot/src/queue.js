const { logger } = require('./utils.js');

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
        logger.setActiveBot(bot);
        logger.debug(`[${this.name}隊列] 新增任務: "${description}" (尚有 ${this.queue.length} 個)`);
        logger.setActiveBot(null);
    }

    async processQueue() {
        while (!this.isShuttingDown) {
            if (this.isProcessing || this.queue.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            this.isProcessing = true;
            const { bot, task, description } = this.queue.shift();

            logger.setActiveBot(bot);
            logger.debug(`[${this.name}隊列] 開始執行任務: "${description}" (剩餘 ${this.queue.length} 個)`);
            logger.setActiveBot(null);

            try {
                await task();
            } catch (error) {
                logger.setActiveBot(bot);
                logger.error(`[${this.name}隊列] 任務 "${description}" 執行失敗: ${error.message}`);
                logger.setActiveBot(null);
            } finally {
                logger.setActiveBot(bot);
                logger.debug(`[${this.name}隊列] 任務 "${description}" 執行完畢，釋放鎖。`);
                logger.setActiveBot(null);
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
}

module.exports = {
    QueueProcessor
};
