import * as readline from 'readline';
import * as util from 'util';

export const Colors = {
    Reset: "\x1b[0m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m", FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m"
};

export const logger = (() => {
    let rlInterface: readline.Interface | null = null;
    let activeBotForLogging: any = null;
    const LogLevel: { [key: string]: number } = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CHAT: 4 };

    const log = (level: number, ...args: any[]) => {
        if (level === LogLevel.DEBUG) {
            // If a bot is active, respect its setting. Otherwise, check the env var as a fallback for non-bot logs.
            if (activeBotForLogging && !activeBotForLogging.config.debugMode) return;
            if (!activeBotForLogging && !process.env.DEBUG) return;
        }
        const isChat = level === LogLevel.CHAT;

        const levelMap: { [key: number]: string } = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
        const levelColorMap: { [key: number]: string } = { 0: Colors.FgMagenta, 1: Colors.FgGreen, 2: Colors.FgYellow, 3: Colors.FgRed, 4: Colors.Reset };

        const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).substring(0, 19);
        const botPrefix = activeBotForLogging ? `[${Colors.FgCyan}${activeBotForLogging.config.botTag}${Colors.Reset}] ` : '';

        const color = levelColorMap[level] || Colors.Reset;
        const levelName = levelMap[level] || 'LOG';
        const standardPrefix = `[${timestamp}] [${color}${levelName}${Colors.Reset}] `;

        const message = util.format(...args);

        if (rlInterface && rlInterface.prompt) {
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 1);
            if (isChat) console.log(`[${timestamp}] ` + botPrefix + message);
            else console.log(standardPrefix + botPrefix + color + message + Colors.Reset);
            rlInterface.prompt(true);
        } else {
            if (isChat) console.log(`[${timestamp}] ` + botPrefix + message);
            else console.log(standardPrefix + botPrefix + color + message + Colors.Reset);
        }
    };
    return {
        setRl: (rl: readline.Interface) => { rlInterface = rl; },
        unsetRl: () => { rlInterface = null; },
        setActiveBot: (bot: any) => { activeBotForLogging = bot; },
        debug: (...args: any[]) => log(LogLevel.DEBUG, ...args),
        info: (...args: any[]) => log(LogLevel.INFO, ...args),
        warn: (...args: any[]) => log(LogLevel.WARN, ...args),
        error: (...args: any[]) => log(LogLevel.ERROR, ...args),
        chat: (...args: any[]) => log(LogLevel.CHAT, ...args),
        Colors: Colors
    };
})();

export function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
