const { QueueProcessor } = require('./queue.js');

const HOME_OPERATION_TIMEOUT = 15000;
const homeQueue = new QueueProcessor('Home', HOME_OPERATION_TIMEOUT);

module.exports = {
    homeQueue,
    HOME_OPERATION_TIMEOUT
};
