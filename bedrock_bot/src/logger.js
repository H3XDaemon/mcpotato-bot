const winston = require('winston');
const readline = require('readline');
const Transport = require('winston-transport');
const { Colors } = require('./colors.js');

let rlInterface = null;

// [核心修正] 建立一個自訂的 Winston Transport 來正確處理 readline 介面
// 這可以避免在格式化函式中產生副作用，並解決 'undefined' 的問題
class ReadlineConsoleTransport extends Transport {
  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // 從 info 物件中獲取最終格式化（且已上色）的訊息
    const message = info[Symbol.for('message')];

    if (rlInterface) {
      // 儲存使用者目前輸入的內容
      const currentLine = rlInterface.line;
      // 清除目前行，印出日誌，然後重繪提示符與使用者輸入
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 1);
      process.stdout.write(message + '\n');
      rlInterface.prompt(true);
    } else {
      // 如果沒有 readline 介面，就使用標準的 console.log
      console.log(message);
    }

    if (callback) {
      callback();
    }
  }
}

// printf 函式現在只負責格式化，不產生任何副作用
const consoleFormat = winston.format.printf(({ level, message, timestamp, botTag, isChatMessage }) => {
  const botPrefix = botTag ? `[${Colors.FgCyan}${botTag}${Colors.Reset}] ` : '';
  // [核心修正] 根據 isChatMessage 旗標來決定是否顯示日誌級別
  if (isChatMessage) {
    return `[${timestamp}] ${botPrefix}${message}`;
  }
  return `[${timestamp}] [${level}] ${botPrefix}${message}`;
});

const logger = winston.createLogger({
  level: process.env.DEBUG ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format(info => {
      info.timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).substring(0, 19);
      return info;
    })(),
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  transports: [
    // 使用我們自訂的 transport
    new ReadlineConsoleTransport({
      format: winston.format.combine(
        winston.format.colorize(), // 先上色
        consoleFormat              // 再套用我們的格式
      )
    }),
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.uncolorize(),
        consoleFormat
      )
    }),
    new winston.transports.File({
      filename: 'combined.log',
      format: winston.format.combine(
        winston.format.uncolorize(),
        consoleFormat
      )
    })
  ]
});

logger.setRl = (rl) => {
  rlInterface = rl;
};

const packetLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, message }) => `[${timestamp}] ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/packets.log', options: { flags: 'w' } })
  ]
});

module.exports = { logger, packetLogger };