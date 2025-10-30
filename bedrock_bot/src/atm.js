const { QueueProcessor } = require('./queue.js');

const ATM_OPERATION_TIMEOUT = 15000;
const atmQueue = new QueueProcessor('ATM', ATM_OPERATION_TIMEOUT);

function setShutdown() {
    atmQueue.setShutdown();
}

function isShuttingDown() {
    return atmQueue.isShuttingDown;
}

module.exports = {
    atmQueue,
    isShuttingDown,
    setShutdown,
    ATM_OPERATION_TIMEOUT
};
