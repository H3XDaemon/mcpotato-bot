const { logger } = require('./utils.js');

const homeQueue = [];
let isHomeProcessing = false;
const HOME_OPERATION_TIMEOUT = 15000;

async function processHomeQueue() {
    if (isHomeProcessing || homeQueue.length === 0) {
        return;
    }
    isHomeProcessing = true;
    const { bot, task, description } = homeQueue.shift();

    logger.setActiveBot(bot);
    logger.debug(`[Home隊列] 開始執行任務: "${description}" (剩餘 ${homeQueue.length} 個)`);
    logger.setActiveBot(null);

    try {
        await task();
    } catch (error) {
        logger.setActiveBot(bot);
        logger.error(`[Home隊列] 任務 "${description}" 執行失敗: ${error.message}`);
        logger.setActiveBot(null);
    } finally {
        logger.setActiveBot(bot);
        logger.debug(`[Home隊列] 任務 "${description}" 執行完畢，釋放鎖。`);
        logger.setActiveBot(null);
        isHomeProcessing = false;
    }
}

function startQueueProcessor() {
    setInterval(processHomeQueue, 1000);
}

module.exports = {
    homeQueue,
    isHomeProcessing,
    startQueueProcessor,
    HOME_OPERATION_TIMEOUT
};
