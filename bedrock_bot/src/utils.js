

const { Colors, MC_COLOR_MAP } = require('./colors.js');

function parseMinecraftColors(text) {
    if (!text) return '';
    return Colors.Reset + text.replace(/§[0-9a-fk-or]/g, match => MC_COLOR_MAP[match] || '') + Colors.Reset;
}


function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

let isAppShuttingDown = false;
const setAppShutdown = () => { isAppShuttingDown = true; };
const getAppShutdown = () => isAppShuttingDown;

const { logger, packetLogger } = require('./logger.js');

module.exports = {
    Colors,
    parseMinecraftColors,
    logger,
    packetLogger,
    sleep,
    setAppShutdown,
    getAppShutdown
};
