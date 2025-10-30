const readline = require('readline');
const { logger, Colors, sleep, getAppShutdown } = require('./utils.js');

function startConsole(botManager, botTagsByIndex) {
    console.log(`\n${Colors.FgCyan}======================================================${Colors.Reset}`);
    console.log(`${Colors.FgCyan}   帳號控制台已啟動，聊天訊息將會自動顯示   ${Colors.Reset}`);
    console.log(`${Colors.FgCyan}   輸入 help 查看指令                         ${Colors.Reset}`);
    console.log(`${Colors.FgCyan}======================================================${Colors.Reset}`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logger.setRl(rl);
    let activeBot = botManager.size > 0 ? botManager.get(botTagsByIndex[0]) : null;
    if (activeBot) console.log(`預設操作目標已設定為: ${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}`);
    
    /**
     * [核心修正] 更新並設定主控台提示符
     * 移除了隊列狀態顯示
     */
    const setPrompt = () => {
        const prefix = activeBot ? `[${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}]` : `[${Colors.FgYellow}未選擇${Colors.Reset}]`;
        rl.setPrompt(`${prefix}> `);
    };

    /**
     * [核心優化] 解析指令，分離出目標和實際參數
     * @param {string[]} args - 原始指令參數陣列
     * @returns {{targets: Bot[], cleanArgs: string[]}} - 解析後的目標機器人陣列和乾淨的參數陣列
     */
    const parseCommandTargets = (args) => {
        const targets = [];
        const cleanArgs = [];
        let customTargetFound = false;

        for (const arg of args) {
            if (arg.startsWith('@')) {
                customTargetFound = true;
                const identifier = arg.substring(1);
                
                if (identifier.toLowerCase() === 'all') {
                    targets.push(...botManager.values());
                    continue;
                }
                
                const index = parseInt(identifier, 10);
                if (!isNaN(index) && index > 0 && index <= botTagsByIndex.length) {
                    const botTag = botTagsByIndex[index - 1];
                    if (botManager.has(botTag)) {
                        targets.push(botManager.get(botTag));
                    } else {
                        logger.error(`找不到索引為 ${index} 的機器人。`);
                    }
                    continue;
                }

                const bot = botManager.get(identifier);
                if (bot) {
                    targets.push(bot);
                } else {
                    logger.error(`找不到機器人: ${identifier}`);
                }
            } else {
                cleanArgs.push(arg);
            }
        }

        // 如果沒有找到任何 @目標，則使用當前活動的機器人
        if (!customTargetFound) {
            if (activeBot) {
                targets.push(activeBot);
            } else {
                logger.error(`錯誤: 未指定目標 (@)，也未選擇預設機器人。`);
            }
        }
        
        // 去除重複的目標
        const uniqueTargets = [...new Set(targets)];
        return { targets: uniqueTargets, cleanArgs };
    };
    
    const commands = {
        'help': () => {
            console.log('\n--- 指令列表 ---');
            console.log('使用 @<BotTag|Index|all> 來指定指令目標。');
            console.log('若不指定目標，指令將對目前選擇的機器人執行。');
            console.log('--- 控制台指令 ---');
            console.log('   help                       - 顯示此幫助訊息');
            console.log('   list                       - 列出所有機器人及其狀態');
            console.log('   bot <BotTag|Index>         - 切換目前操作的機器人');
            console.log('   queue                      - 查看當前機器人的任務隊列');
            console.log('   connect [@目標]            - 連線機器人 (若為 @all 會自動延遲)');
            console.log('   disconnect [@目標]         - 斷開機器人連線');
            console.log('   exit                       - 優雅地關閉所有程式');
            console.log('   debug <on|off> [@目標]     - 開關通用除錯日誌');
            console.log('--- ATM 指令 ---');
            console.log('   atm list [@目標]           - [隊列] 查看 ATM 內容');
            console.log('   atm take <slot> [@目標]    - [隊列] 從 ATM 拿取物品');
            console.log('   autowithdraw <on|off> [@目標]  - 開關自動提款功能');
            console.log('   autowithdraw status [@目標]    - 查看自動提款狀態');
            console.log('--- Home 指令 ---');
            console.log('   home list [@目標]          - [隊列] 列出所有家');
            console.log('   home tp <家名稱> [@目標]   - [隊列] 傳送到指定的家');
            console.log('--- 遊戲內指令 ---');
            console.log('   /<指令> [@目標]            - 由指定或當前選擇的機器人執行');
            console.log('   //<指令>                   - 由所有線上機器人執行 (快捷方式)');
        },
        'list': () => {
            console.log('\n--- 機器人狀態列表 ---');
            botTagsByIndex.forEach((botTag, index) => {
                const bot = botManager.get(botTag);
                const statusColors = { 'ONLINE': Colors.FgGreen, 'CONNECTING': Colors.FgYellow, 'OFFLINE': Colors.FgRed, 'STOPPED': Colors.FgMagenta };
                const color = statusColors[bot.state.status] || Colors.Reset;
                const isActive = activeBot && bot.config.botTag === activeBot.config.botTag ? ` ${Colors.FgYellow}<-- 目前操作${Colors.Reset}` : '';
                const indexStr = `[${index + 1}]`.padEnd(4);
                const respawnStatus = bot.config.autoRespawn ? `${Colors.FgGreen}開${Colors.Reset}` : `${Colors.FgRed}關${Colors.Reset}`;
                const debugStatus = (() => {
                    if (bot.config.debug === false) return `${Colors.FgCyan}關${Colors.Reset}`;
                    if (Array.isArray(bot.config.debug)) return `${Colors.FgYellow}白名單${Colors.Reset}`;
                    return `${Colors.FgGreen}開${Colors.Reset}`;
                })();
                console.log(`${indexStr} - ${bot.config.botTag.padEnd(15)} | 狀態: ${color}${bot.state.status.padEnd(10)}${Colors.Reset} | 除錯: ${debugStatus.padEnd(14)} | 自動重生: ${respawnStatus}${isActive}`);
            });
        },
        'inv': async (args) => {
            const { targets } = parseCommandTargets(args);
            for (const bot of targets) {
                if (bot.state.status === 'ONLINE') {
                    await bot.listInventory();
                } else {
                    logger.warn(`${bot.config.botTag} 不在線上，無法查看物品欄。`);
                }
            }
        },
        'bot': ([target]) => {
            if (!target) return console.log(`\n目前選擇的機器人: ${activeBot ? activeBot.config.botTag : '無'}`);
            const identifier = target.startsWith('@') ? target.substring(1) : target;
            const index = parseInt(identifier, 10);
            let foundBot = null;
            if (!isNaN(index) && index > 0 && index <= botTagsByIndex.length) {
                foundBot = botManager.get(botTagsByIndex[index - 1]);
            } else {
                foundBot = botManager.get(identifier);
            }

            if (foundBot) {
                activeBot = foundBot;
                console.log(`\n已切換操作目標為: ${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}`);
            } else {
                logger.error(`找不到機器人: ${target}`);
            }
        },
        'connect': async (args) => {
            const { targets } = parseCommandTargets(args);
            const CONNECT_INTERVAL = 6000;
            for (const bot of targets) {
                bot.connect();
                if (targets.length > 1) {
                    await sleep(CONNECT_INTERVAL);
                }
            }
        },
        'disconnect': (args) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => bot.disconnect());
        },
        'respawn': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const [setting] = cleanArgs;
            targets.forEach(bot => {
                if (setting) {
                    let newState;
                    if (setting.toLowerCase() === 'on') newState = true;
                    else if (setting.toLowerCase() === 'off') newState = false;
                    else newState = !bot.config.autoRespawn;
                    bot.config.autoRespawn = newState;
                    const statusText = newState ? `${Colors.FgGreen}開啟${Colors.Reset}` : `${Colors.FgRed}關閉${Colors.Reset}`;
                    bot.logger.info(`自動重生已設定為: ${statusText}`);
                } else {
                    bot.manualRespawn();
                }
            });
        },
        'queue': () => {
            if (!activeBot) return logger.error('錯誤: 尚未選擇任何機器人。');
            console.log(`\n--- ${activeBot.config.botTag} 的任務隊列 ---`);
            const queueInstance = activeBot.uiQueue.getQueue();
            if (queueInstance.length === 0) {
                console.log('隊列是空的。');
            } else {
                queueInstance.forEach((item, index) => console.log(`${index + 1}. ${item.description}`));
            }
            console.log('--------------------------');
        },
        'atm': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const [action, ...rest] = cleanArgs;
            if (!action) return commands.help();
            
            const actionLower = action.toLowerCase();
            
            switch(actionLower) {
                case 'list':
                    targets.forEach(bot => bot.listAtmContents());
                    break;
                case 'take':
                    if (rest.length < 1) return logger.error(`用法: atm take <欄位編號> [@目標]`);
                    const slot = parseInt(rest[0], 10);
                    if (isNaN(slot)) return logger.error('無效的欄位編號。');
                    targets.forEach(bot => bot.performTakeAction(slot, 'take'));
                    break;
                default:
                    logger.error(`未知的 atm 指令: "${action}".`);
            }
        },
        'autowithdraw': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const [action] = cleanArgs;

            if (!action) {
                logger.error(`用法: autowithdraw <on|off|status> [@目標]`);
                return;
            }

            targets.forEach(bot => {
                const statusText = bot.autoWithdrawIntervalId ? `${Colors.FgGreen}運行中${Colors.Reset}` : `${Colors.FgRed}已停止${Colors.Reset}`;
                switch (action.toLowerCase()) {
                    case 'on':
                        bot.config.autoWithdraw.enabled = true;
                        if(bot.state.status === 'ONLINE') bot.startAutoWithdraw();
                        else bot.logger.info('將在機器人上線後自動啟動提款功能。');
                        break;
                    case 'off':
                        bot.config.autoWithdraw.enabled = false;
                        bot.stopAutoWithdraw();
                        break;
                    case 'status':
                        bot.logger.info(`自動提款狀態: ${statusText} | 門檻: $${bot.config.autoWithdraw.withdrawThreshold} | 間隔: ${bot.config.autoWithdraw.intervalMinutes}分鐘`);
                        break;
                    default:
                        logger.error(`未知的 autowithdraw 指令: "${action}". 請使用 on, off, 或 status。`);
                }
            });
        },
        'home': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const [action, ...rest] = cleanArgs;
            if (!action) return commands.help();
            
            const actionLower = action.toLowerCase();
            
            switch(actionLower) {
                case 'list':
                    targets.forEach(bot => bot.listHomes());
                    break;
                case 'tp':
                    if (rest.length < 1) return logger.error(`用法: home tp <家名稱> [@目標]`);
                    const homeName = rest[0];
                    targets.forEach(bot => bot.teleportHome(homeName));
                    break;
                default:
                    logger.error(`未知的 home 指令: "${action}".`);
            }
        },
        'debug': (args) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const [action] = cleanArgs;
            if (!action) {
                logger.error('用法: debug <on|off> [@目標]');
                return;
            }
        
            let newState;
            let statusText;
        
            switch (action.toLowerCase()) {
                case 'on':
                    newState = true;
                    statusText = `${Colors.FgGreen}開啟${Colors.Reset}`;
                    break;
                case 'off':
                    newState = false;
                    statusText = `${Colors.FgRed}關閉${Colors.Reset}`;
                    break;
                default:
                    logger.error(`未知的 debug 動作: "${action}". 請使用 on 或 off。`);
                    return;
            }
        
            targets.forEach(bot => {
                bot.config.debug = newState;
                bot.logger.info(`詳細除錯日誌已: ${statusText}`);
            });
        },
        'exit': () => rl.close()
    };
    
    // 顯示初始提示符
    setPrompt();
    rl.prompt();

    rl.on('line', async (line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine || getAppShutdown()) {
            rl.prompt();
            return;
        }

        if (trimmedLine.startsWith('//')) {
            const commandToRun = trimmedLine.substring(2).trim();
            if (commandToRun) {
                logger.info(`[ALL] > /${commandToRun}`);
                botManager.forEach(bot => {
                    if (bot.state.status === 'ONLINE') bot.runCommand(commandToRun);
                });
            }
        } else if (trimmedLine.startsWith('/')) {
            const args = trimmedLine.substring(1).split(/\s+/);
            const { targets, cleanArgs } = parseCommandTargets(args);
            const commandToRun = cleanArgs.join(' ');
            
            if (commandToRun) {
                targets.forEach(bot => bot.runCommand(commandToRun));
            } else {
                logger.warn(`遊戲指令不可為空。`);
            }
        } else {
            const [command, ...args] = trimmedLine.split(/\s+/);
            const handler = commands[command.toLowerCase()];
            if (handler) {
                await handler(args);
            } else {
                logger.error(`未知指令: "${command}". 請輸入 'help' 查看可用指令。`);
            }
        }

        setPrompt();
        rl.prompt();
    });

    rl.on('close', () => {
        // 觸發優雅關閉程序 (從 main.js 移過來)
        rl.emit('SIGINT');
    });

    return rl;
}

module.exports = { startConsole };
