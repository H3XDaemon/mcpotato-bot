const util = require('util');
const readline = require('readline');

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

const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CHAT: 4 };
let activeBotForLogging = null;

const logger = (() => {
    let rlInterface = null;
    const log = (level, ...args) => {
        const isChat = level === LogLevel.CHAT;
        if (level < (process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO) && !isChat) return;
        
        const levelMap = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
        const levelColorMap = {
            0: Colors.FgMagenta, // DEBUG
            1: Colors.FgGreen,   // INFO
            2: Colors.FgYellow,  // WARN
            3: Colors.FgRed,     // ERROR
            4: Colors.Reset      // CHAT
        };

        const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).substring(0, 19);
        const botPrefix = activeBotForLogging ? `[${Colors.FgCyan}${activeBotForLogging.config.botTag}${Colors.Reset}] ` : '';
        
        const color = levelColorMap[level] || Colors.Reset;
        // [核心修正] 移除 padEnd(5) 來修正多餘的空格
        const levelName = levelMap[level] || 'LOG';
        const standardPrefix = `[${timestamp}] [${color}${levelName}${Colors.Reset}] `;

        const message = util.format(...args);
        
        if (rlInterface && rlInterface.prompt) {
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 1);
            if (isChat) {
                console.log(botPrefix + message);
            } else {
                console.log(standardPrefix + botPrefix + color + message + Colors.Reset);
            }
            rlInterface.prompt(true);
        } else {
             if (isChat) {
                console.log(botPrefix + message);
            } else {
                console.log(standardPrefix + botPrefix + color + message + Colors.Reset);
            }
        }
    };
    return {
        setRl: (rl) => { rlInterface = rl; },
        setActiveBot: (bot) => { activeBotForLogging = bot; },
        debug: (...args) => log(LogLevel.DEBUG, ...args),
        info: (...args) => log(LogLevel.INFO, ...args),
        warn: (...args) => log(LogLevel.WARN, ...args),
        error: (...args) => log(LogLevel.ERROR, ...args),
        chat: (...args) => log(LogLevel.CHAT, ...args),
    };
})();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

let isAppShuttingDown = false;
const setAppShutdown = () => { isAppShuttingDown = true; };
const getAppShutdown = () => isAppShuttingDown;

module.exports = {
    Colors,
    parseMinecraftColors,
    logger,
    sleep,
    setAppShutdown,
    getAppShutdown
};
