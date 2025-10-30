

const Colors = {
    Reset: "\x1b[0m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m", FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m",
    Bright: "\x1b[1m", Dim: "\x1b[2m", Underscore: "\x1b[4m", Blink: "\x1b[5m", Reverse: "\x1b[7m", Hidden: "\x1b[8m"
};

const MC_COLOR_MAP = {
    '§0': '\x1b[30m', '§1': '\x1b[34m', '§2': '\x1b[32m', '§3': '\x1b[36m',
    '§4': '\x1b[31m', '§5': '\x1b[35m', '§6': '\x1b[33m', '§7': '\x1b[37m',
    '§8': '\x1b[90m', '§9': '\x1b[94m', '§a': '\x1b[92m', '§b': '\x1b[96m',
    '§c': '\x1b[91m', '§d': '\x1b[95m', '§e': '\x1b[93m', '§f': '\x1b[97m',
    '§l': '\x1b[1m', '§o': '\x1b[3m', '§n': '\x1b[4m', '§m': '\x1b[9m',
    '§r': '\x1b[0m', '§k': '\x1b[8m'
};

function parseMinecraftColors(text) {
    if (!text) return '';
    return Colors.Reset + text.replace(/§[0-9a-fk-or]/g, match => MC_COLOR_MAP[match] || '') + Colors.Reset;
}


function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

let isAppShuttingDown = false;
const setAppShutdown = () => { isAppShuttingDown = true; };
const getAppShutdown = () => isAppShuttingDown;

const { logger } = require('./logger.js');

module.exports = {
    Colors,
    parseMinecraftColors,
    logger,
    sleep,
    setAppShutdown,
    getAppShutdown
};
