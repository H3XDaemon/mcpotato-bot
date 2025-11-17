import { logger, Colors } from './utils.js';
import * as readline from 'readline';
import { listWindowItems, takeItemFromWindow, interactiveWindowGui, rideVehicle } from './actions.js';


export function startConsole(botManager: Map<string, any>, botTagsByIndex: string[]) {
    console.log(`
${Colors.FgCyan}======================================================${Colors.Reset}`);
    console.log(`${Colors.FgCyan}   Java 版帳號控制台已啟動                                       ${Colors.Reset}`);
    console.log(`${Colors.FgCyan}   輸入 help 查看指令                                          ${Colors.Reset}`);
    console.log(`${Colors.FgCyan}======================================================${Colors.Reset}`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logger.setRl(rl);
    let activeBot: any = botManager.size > 0 ? botManager.get(botTagsByIndex[0]) : null;
    if (activeBot) console.log(`預設操作目標已設定為: ${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}`);

    const setPrompt = () => {
        let prefix;
        if (activeBot) {
            const workIndicator = activeBot.isWorking ? '🟢' : '⚫️';
            prefix = `${workIndicator} [${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}]`;
        } else {
            prefix = `[${Colors.FgYellow}未選擇${Colors.Reset}]`;
        }
        rl.setPrompt(`${prefix}> `);
    };

    const parseCommandTargets = (args: string[]) => {
        const targets: any[] = [];
        const cleanArgs: string[] = [];
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
                    if (botManager.has(botTag)) targets.push(botManager.get(botTag));
                    else logger.error(`找不到索引為 ${index} 的機器人。`);
                    continue;
                }

                const bot = botManager.get(identifier);
                if (bot) targets.push(bot);
                else logger.error(`找不到機器人: ${identifier}`);
            } else {
                cleanArgs.push(arg);
            }
        }

        if (!customTargetFound) {
            if (activeBot) targets.push(activeBot);
            else logger.error(`錯誤: 未指定目標 (@)，也未選擇預設機器人。`);
        }

        const uniqueTargets = [...new Set(targets)];
        return { targets: uniqueTargets, cleanArgs };
    };

    const commands: { [key: string]: (args: string[]) => void } = {
        'help': () => {
            console.log(`
--- 指令列表 ---
使用 @<BotTag|Index|all> 來指定指令目標。
若不指定目標，指令將對目前選擇的機器人執行。
--- 控制台指令 ---
   help                 - 顯示此幫助訊息
   list                 - 列出所有機器人及其狀態
   view [@目標]         - 顯示指定機器人的監看網址
   bot <BotTag|Index>   - 切換目前操作的機器人
   connect [@目標]      - 連線機器人
   disconnect [@目標]   - 斷開機器人連線
   exit                 - 優雅地關閉所有程式
   debug [@目標]        - 切換除錯模式 (顯示額外資訊)
--- 遊戲內指令 ---
   say <訊息> [@目標]   - 在遊戲中發言
   work <start|stop> [@目標] - 啟動或停止自動 Trial Omen 工作模式
   task <list|start|stop> [@目標] - 管理背景任務 (例如 AH, PW 掃描)
   mount <cart|boat> [wait] [@目標] - 騎乘附近的礦車或船 (使用 'wait cart' 等待礦車)
   dismount [@目標]     - 從坐騎上下來
   lever [<編號>|<方塊>] - 掃描，或依編號/方塊名啟動拉桿
   pos [@目標]          - 取得目前座標
   tps [@目標]          - 取得伺服器目前的 TPS (多種方法)
   exp [toggle] [@目標] - 顯示經驗值資訊，或開關 exp/h 日誌
   test drop [@目標]    - 丟棄物品以測試 itemDrop 事件
   atm list [@目標]     - 列出虛擬銀行 (ATM) 內容物
   atm take <欄位> [@目標] - 從 ATM 拿取物品
   atm gui [@目標]      - 開啟 ATM 互動介面
   inv list [@目標]     - 列出指定機器人的背包內容物
   /<指令> [@目標]      - 由指定或當前選擇的機器人執行指令
   //<指令>             - 由所有線上機器人執行指令 (快捷方式)
`);
        },
        'list': () => {
            console.log(`
--- 機器人狀態列表 ---`);
            botTagsByIndex.forEach((botTag: string, index: number) => {
                const bot = botManager.get(botTag);
                const statusColors: { [key: string]: string } = { 'ONLINE': Colors.FgGreen, 'CONNECTING': Colors.FgYellow, 'OFFLINE': Colors.FgRed, 'STOPPED': Colors.FgMagenta };
                const color = statusColors[bot.state.status] || Colors.Reset;
                const isActive = activeBot && bot.config.botTag === activeBot.config.botTag ? ` ${Colors.FgYellow}<-- 目前操作${Colors.Reset}` : '';
                const indexStr = `[${index + 1}]`.padEnd(4);
                const viewerStatus = bot.config.enableViewer ? (bot.viewer.port ? `http://localhost:${bot.viewer.port}` : '已設定') : '已停用';
                const workIndicator = bot.isWorking ? '🟢' : '⚫️';
                console.log(`${indexStr} - ${bot.config.botTag.padEnd(15)} | 狀態: ${color}${bot.state.status.padEnd(10)}${Colors.Reset} | 工作: ${workIndicator} | 監看: ${viewerStatus}${isActive}`);
            });
        },
        'view': (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach(bot => {
                if (!bot.config.enableViewer) {
                    bot.logger.warn('此機器人的監看功能已在設定檔中停用。');
                } else if (bot.viewer.port) {
                    bot.logger.info(`監看網址: http://localhost:${bot.viewer.port}`);
                } else {
                    bot.logger.warn('監看視窗尚未啟動或機器人未連線。');
                }
            });
        },
        'bot': ([target]: string[]) => {
            if (!target) return console.log(`
目前選擇的機器人: ${activeBot ? activeBot.config.botTag : '無'}`);
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
                console.log(`
已切換操作目標為: ${Colors.FgCyan}${activeBot.config.botTag}${Colors.Reset}`);
            } else {
                logger.error(`找不到機器人: ${target}`);
            }
        },
        'connect': async (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            for (const bot of targets) {
                await bot.connect();
            }
        },
        'disconnect': (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach((bot: any) => bot.disconnect());
        },
        'exit': () => rl.close(),
        'debug': (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach((bot: any) => {
                bot.config.debugMode = !bot.config.debugMode;
                bot.logger.info(`除錯模式已${bot.config.debugMode ? '開啟' : '關閉'}。`);
            });
        },
        'say': (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            if (cleanArgs.length === 0) {
                logger.error('請輸入要發送的訊息。用法: say <訊息>');
                return;
            }
            const message = cleanArgs.join(' ');
            targets.forEach((bot: any) => bot.runCommand(message));
        },
        'work': (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (!['start', 'stop'].includes(subCommand)) {
                logger.error('無效的 work 指令。支援 "start", "stop"。');
                return;
            }

            targets.forEach((bot: any) => {
                if (subCommand === 'start') {
                    if (bot.state.status === 'ONLINE') {
                        bot.startWork();
                    } else {
                        bot.logger.warn('機器人未上線，無法啟動工作模式。');
                    }
                } else if (subCommand === 'stop') {
                    bot.stopWork();
                }
            });
        },
        'mount': async (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const vehicleType = cleanArgs[0]?.toLowerCase(); // e.g., 'cart', 'boat'
            const action = cleanArgs[1]?.toLowerCase(); // e.g., 'wait'

            if (!['cart', 'boat'].includes(vehicleType)) {
                logger.error('無效的 mount 指令。支援 "cart" (礦車), "boat" (船)。');
                return;
            }
            if (action && action !== 'wait') {
                logger.error('無效的 mount 動作。支援 "wait"。');
                return;
            }
            if (action === 'wait' && vehicleType !== 'cart') {
                logger.error('目前 "wait" 動作僅支援 "cart" (礦車)。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE') {
                    bot.logger.warn('機器人未上線，無法執行騎乘操作。');
                    continue;
                }

                if (action === 'wait' && vehicleType === 'cart') {
                    try {
                        await bot.waitForMinecartAndMount();
                    } catch (error: any) {
                        bot.logger.error(`等待並騎乘礦車失敗: ${error.message}`);
                    }
                } else if (vehicleType === 'cart') {
                    await rideVehicle(bot, 'minecart', '礦車');
                } else if (vehicleType === 'boat') {
                    await rideVehicle(bot, 'boat', '船');
                }
            }
        },
        'dismount': (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach((bot: any) => {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn('機器人未上線，無法下坐騎。');
                    return;
                }
                if (bot.client.vehicle) {
                    bot.client.dismount();
                    bot.logger.info('已成功下坐騎。');
                } else {
                    bot.logger.warn('機器人目前沒有在任何坐騎上。');
                }
            });
        },
        'lever': async (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const argument = cleanArgs[0];

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE') {
                    bot.logger.warn('機器人未上線，無法執行拉桿指令。');
                    continue;
                }

                // Case 1: No argument - Scan for levers
                if (!argument) {
                    const reportLines = await bot.findAndReportLevers();
                    reportLines.forEach((line: string) => bot.logger.info(line));
                    continue;
                }

                // Case 2: Argument is a number - Activate by index
                const index = parseInt(argument, 10);
                if (!isNaN(index)) {
                    await bot.activateLeverByIndex(index);
                    continue;
                }

                // Case 3: Argument is a string - Activate near anchor block
                await bot.activateLeverNearBlock(argument);
            }
        },
        'pos': (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            targets.forEach((bot: any) => {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn('機器人未上線，無法取得座標。');
                    return;
                }
                const pos = bot.client.entity.position;
                const message = `目前座標: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}`;
                bot.logger.info(message);
            });
        },
        'tps': async (args: string[]) => {
            const { targets } = parseCommandTargets(args);
            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client || !bot.tpsMonitor) {
                    bot.logger.warn('機器人未上線，無法取得 TPS。');
                    continue;
                }
                try {
                    const packetTps = bot.tpsMonitor.getPacketTPS();
                    const physicsTps = bot.tpsMonitor.getPhysicsTPS();
                    const gameTimeTps = bot.tpsMonitor.getGameTimeTPS();

                    const formatTps = (tps: number) => (tps < 0 ? '錯誤' : tps.toFixed(2).padStart(5));

                    bot.logger.info(`伺服器 TPS - [封包]: ${formatTps(packetTps)} | [物理]: ${formatTps(physicsTps)} | [時間]: ${formatTps(gameTimeTps)}`);

                } catch (error: any) {
                    bot.logger.error(`取得 TPS 時發生錯誤: ${error.message}`);
                }
            }
        },
        'exp': (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            targets.forEach((bot: any) => {
                if (subCommand === 'toggle') {
                    bot.toggleExpLogging();
                } else {
                    bot.displayExperience();
                }
            });
        },
        'test': async (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (subCommand !== 'drop') {
                logger.error('無效的 test 指令。目前僅支援 "test drop"。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn('機器人未上線，無法執行測試。');
                    continue;
                }

                try {
                    // 尋找背包中的第一個物品
                    const itemToToss = bot.client.inventory.items()[0];
                    if (itemToToss) {
                        bot.logger.info(`[測試] 正在從背包丟棄 '${itemToToss.displayName}' (x${itemToToss.count}) 以觸發 itemDrop 事件...`);
                        await bot.client.tossStack(itemToToss);
                        bot.logger.info(`[測試] 物品已丟出。請檢查控制台是否有 '[掉落物]' 相關的日誌訊息。`);
                    } else {
                        bot.logger.warn('[測試] 背包是空的，無法執行掉落測試。');
                    }
                } catch (error: any) {
                    bot.logger.error(`執行掉落測試時發生錯誤: ${error.message}`);
                }
            }
        },
        'atm': async (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0];

            if (targets.length === 0) {
                logger.error('錯誤: 未指定目標 (@)，也未選擇預設機器人來執行 atm 指令。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn(`機器人未上線或未完全初始化，無法執行 atm 指令。`);
                    continue;
                }

                switch (subCommand) {
                    case 'list':
                        await listWindowItems(bot, '/atm', '虛擬銀行 (ATM)');
                        break;
                    case 'take': {
                        const slot = parseInt(cleanArgs[1], 10);
                        if (isNaN(slot)) {
                            bot.logger.error('無效的欄位編號。用法: atm take <欄位編號>');
                            continue;
                        }
                        await takeItemFromWindow(bot, '/atm', '虛擬銀行 (ATM)', slot);
                        break;
                    }
                    case 'gui':
                        if (targets.indexOf(bot) > 0) {
                            bot.logger.warn(`atm gui 指令一次只能對一個機器人執行，已忽略 ${bot.config.botTag}。`);
                            continue;
                        }
                        await interactiveWindowGui(bot, '/atm', '虛擬銀行 (ATM)', rl);
                        break;
                    default:
                        bot.logger.error('無效的 atm 指令。支援 "list", "take", "gui"。');
                        break;
                }
            }
        },
        'inv': async (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0];

            if (subCommand !== 'list') {
                logger.error('無效的 inv 指令。目前僅支援 "inv list"。');
                return;
            }

            if (targets.length === 0) {
                logger.error('錯誤: 未指定目標 (@)，也未選擇預設機器人來執行 "inv list"。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE' || !bot.client) {
                    bot.logger.warn(`機器人未上線，無法執行 "inv list"。`);
                    continue;
                }

                try {
                    const items = bot.client.inventory.items();
                    const header = `--- [${bot.config.botTag} 的背包] 內容 ---`;
                    bot.logger.chat(header);

                    if (items.length === 0) {
                        bot.logger.chat('   -> 背包是空的。');
                    } else {
                        const outputLines = items.map((item: any) => {
                            const itemName = item.displayName;
                            return `     - 欄位 ${String(item.slot).padEnd(3)} | ${itemName} (x${item.count})`;
                        });
                        bot.logger.chat(outputLines.join('\n'));
                    }
                    const footer = `------------------------------------`;
                    bot.logger.chat(footer);

                } catch (error: any) {
                    bot.logger.error(`執行 "inv list" 時發生錯誤: ${error.message}`);
                }
            }
        },
        'task': async (args: string[]) => {
            const { targets, cleanArgs } = parseCommandTargets(args);
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (targets.length === 0) {
                logger.error('錯誤: 未指定目標 (@)，也未選擇預設機器人來執行 task 指令。');
                return;
            }

            for (const bot of targets) {
                if (!bot.taskManager) {
                    bot.logger.warn('任務管理器尚未初始化。');
                    continue;
                }

                switch (subCommand) {
                    case 'list': {
                        const available = bot.taskManager.getAvailableTasks();
                        const active = bot.taskManager.getActiveTaskName();
                        bot.logger.info(`--- [${bot.config.botTag}] 任務列表 ---`);
                        bot.logger.info(`可用任務: ${available.join(', ') || '無'}`);
                        bot.logger.info(`正在執行: ${active || '無'}`);
                        break;
                    }
                    case 'start': {
                        const taskName = cleanArgs[1];
                        if (!taskName) {
                            bot.logger.error('請指定要啟動的任務名稱。用法: task start <TaskName>');
                            continue;
                        }
                        const interval = cleanArgs[2] ? parseInt(cleanArgs[2], 10) * 1000 : undefined;
                        if (interval !== undefined && isNaN(interval)) {
                            bot.logger.error('無效的間隔時間，請輸入秒數。');
                            continue;
                        }
                        await bot.taskManager.start(taskName, interval);
                        break;
                    }
                    case 'stop': {
                        await bot.taskManager.stop();
                        break;
                    }
                    default:
                        bot.logger.error('無效的 task 指令。支援 "list", "start <TaskName> [IntervalSeconds]", "stop"。');
                        break;
                }
            }
        }
    };

    setPrompt();
    rl.prompt();

    rl.on('line', async (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
            rl.prompt();
            return;
        }

        if (trimmedLine.startsWith('//')) {
            const commandToRun = trimmedLine.substring(1);
            if (commandToRun.length > 1) {
                logger.info(`[ALL] > ${commandToRun}`);
                botManager.forEach((bot: any) => {
                    if (bot.state.status === 'ONLINE') bot.runCommand(commandToRun);
                });
            }
        }
        else {
            const [command, ...args] = trimmedLine.split(/\s+/);
            const handler = commands[command.toLowerCase()];
            if (handler) {
                await handler(args);
            } else if (trimmedLine.startsWith('/')) {
                const { targets } = parseCommandTargets(args);
                targets.forEach((bot: any) => bot.runCommand(trimmedLine));
            }
            else {
                logger.error(`未知指令: '${command}'。輸入 'help' 查看可用指令。`);
            }
        }

        setPrompt();
        rl.prompt();
    });

    return rl;
}
