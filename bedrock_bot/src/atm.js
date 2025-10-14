const { logger } = require('./utils.js');

const atmQueue = [];
let isAtmProcessing = false;
const ATM_OPERATION_TIMEOUT = 15000;
let isShuttingDownState = false;

async function processAtmQueue() {
    if (isAtmProcessing || atmQueue.length === 0) {
        return;
    }
    isAtmProcessing = true;
    const { bot, task, description } = atmQueue.shift();

    logger.setActiveBot(bot);
    logger.debug(`[ATM隊列] 開始執行任務: "${description}" (剩餘 ${atmQueue.length} 個)`);
    logger.setActiveBot(null);

    try {
        await task();
    } catch (error) {
        logger.setActiveBot(bot);
        logger.error(`[ATM隊列] 任務 "${description}" 執行失敗: ${error.message}`);
        logger.setActiveBot(null);
    } finally {
        logger.setActiveBot(bot);
        logger.debug(`[ATM隊列] 任務 "${description}" 執行完畢，釋放鎖。`);
        logger.setActiveBot(null);
        isAtmProcessing = false;
    }
}

function startQueueProcessor() {
    setInterval(processAtmQueue, 1000);
}

function setShutdown() {
    isShuttingDownState = true;
}

function isShuttingDown() {
    return isShuttingDownState;
}

module.exports = {
    atmQueue,
    isAtmProcessing,
    isShuttingDown,
    setShutdown,
    startQueueProcessor,
    ATM_OPERATION_TIMEOUT
};
