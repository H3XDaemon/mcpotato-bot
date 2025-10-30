const winston = require('winston');
const readline = require('readline');

const Colors = {
    Reset: "\x1b[0m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m", FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m",
};

let rlInterface = null;

const consoleFormat = winston.format.printf(({ level, message, timestamp, botTag, ...metadata }) => {
    let levelStr = `[${level.toUpperCase()}]`;
    if (level === 'info') levelStr = `[${Colors.FgGreen}INFO${Colors.Reset}]`;
    if (level === 'warn') levelStr = `[${Colors.FgYellow}WARN${Colors.Reset}]`;
    if (level === 'error') levelStr = `[${Colors.FgRed}ERROR${Colors.Reset}]`;
    if (level === 'debug') levelStr = `[${Colors.FgMagenta}DEBUG${Colors.Reset}]`;

    const botPrefix = botTag ? `[${Colors.FgCyan}${botTag}${Colors.Reset}] ` : '';
    
    let msg = `[${timestamp}] ${levelStr} ${botPrefix}${message}`;

    if (rlInterface) {
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 1);
        process.stdout.write(msg + '\n');
        rlInterface.prompt(true);
    } else {
        console.log(msg);
    }
});


const logger = winston.createLogger({
    level: process.env.DEBUG ? 'debug' : 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                consoleFormat
            )
        }),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

logger.setRl = (rl) => {
    rlInterface = rl;
};


module.exports = { logger };
