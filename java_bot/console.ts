
import { logger, sleep, Colors } from './bot_core.js';
import * as readline from 'readline';
import * as util from 'util';
import ChatMessage from 'prismarine-chat';

export { startConsole, nbtToJson, openWindow, getCustomName, listWindowItems, takeItemFromWindow, interactiveWindowGui, rideVehicle };

// =================================================================================
// 3. CONSOLE INTERFACE (主控台介面)
// =================================================================================
function nbtToJson(nbt: any): any {
    if (typeof nbt !== 'object' || nbt === null) {
        return nbt;
    }
    if (nbt.type && nbt.value !== undefined) {
        switch (nbt.type) {
            case 'list':
                return nbt.value.value.map(nbtToJson);
            case 'compound':
                return nbtToJson(nbt.value);
            default:
                return nbt.value;
        }
    }
    if (!nbt.type) {
        const newObj: { [key: string]: any } = {};
        for (const key in nbt) {
            newObj[key] = nbtToJson(nbt[key]);
        }
        return newObj;
    }
    return nbt;
}

async function openWindow(botInstance: any, command: string, windowName: string): Promise<any> {
    if (botInstance.isGuiBusy) {
        botInstance.logger.warn(`無法開啟 ${windowName}，因為另一個介面操作正在進行中。`);
        return null;
    }

    const bot = botInstance.client;
    if (!bot) {
        botInstance.logger.warn('機器人未連線，無法開啟視窗。');
        return null;
    }

    botInstance.isGuiBusy = true;
    let onWindowOpen: (window: any) => void;
    try {
        botInstance.logger.info(`正在發送 ${command} 指令並等待 ${windowName} 介面...`);
        const window = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                bot.removeListener('windowOpen', onWindowOpen);
                reject(new Error(`等待 ${windowName} 視窗開啟超時 (10秒)`));
            }, 10000);

            onWindowOpen = (win: any) => {
                if (win.id === 0) {
                    botInstance.logger.debug("已忽略玩家物品欄開啟事件。");
                    return;
                }
                clearTimeout(timer);
                bot.removeListener('windowOpen', onWindowOpen);
                resolve(win);
            };

            bot.on('windowOpen', onWindowOpen);
            botInstance.runCommand(command);
        });

        const pollingStart = Date.now();
        const POLLING_TIMEOUT = 10000;
        while (Date.now() - pollingStart < POLLING_TIMEOUT) {
            if ((window as any).containerItems().length > 0) {
                botInstance.logger.debug(`在 ${Date.now() - pollingStart}ms 後成功載入視窗物品。`);
                return window;
            }
            await sleep(250);
        }
        botInstance.logger.warn(`無法從 ${windowName} 載入任何物品。`);
        return window;
    } catch (error: any) {
        botInstance.logger.error(`開啟 ${windowName} 視窗時發生錯誤: ${error.message}`);
        return null;
    } finally {
        botInstance.isGuiBusy = false;
    }
}

function getCustomName(item: any, botInstance: any): string | null {
    try {
        if (!item) return null;

        if (botInstance.config.debugMode && item.components) {
            botInstance.logger.info(`[Component Debug] 正在檢測 ${item.name} 的 components: ${util.inspect(item.components, { depth: null })}`);
        }

        let customNameData: any = null;

        if (Array.isArray(item.components)) {
            const customNameComponent = item.components.find((c: any) => c.type === 'minecraft:custom_name' || c.type === 'custom_name');
            if (customNameComponent && customNameComponent.data) {
                customNameData = nbtToJson(customNameComponent.data);
            }
        }
        else if (item.nbt?.value?.display?.value?.Name?.value) {
            customNameData = JSON.parse(item.nbt.value.display.value.Name.value);
        }

        if (customNameData) {
            const ChatMessageParser = ChatMessage(botInstance.client.registry);
            const parsedName = new ChatMessageParser(customNameData).toString().trim();
            if (parsedName) {
                return parsedName;
            }
        }

        return null;
    } catch (e: any) {
        botInstance.logger.warn(`解析物品 ${item.name} 的自訂名稱時發生錯誤: ${e.message}`);
        return null;
    }
}

async function listWindowItems(botInstance: any, command: string, windowName: string): Promise<void> {
    let window: any = null;
    try {
        window = await openWindow(botInstance, command, windowName);
        if (!window) return;

        const items = window.containerItems();
        botInstance.logger.chat(`--- ${botInstance.config.botTag} 的 ${windowName} 物品列表 ---`);

        const relevantItems = items.filter((item: any) => item.name !== 'gray_stained_glass_pane');

        if (relevantItems.length === 0) {
            botInstance.logger.chat('   -> 介面內沒有可操作的物品。');
        } else {
            const outputLines = relevantItems.map((item: any) => {
                const slot = `欄位: ${String(item.slot).padEnd(3)}`;
                const displayName = item.displayName.padEnd(22);
                const customName = getCustomName(item, botInstance);

                if (customName) {
                    return `- ${slot} | ${displayName} | ${customName}`;
                } else {
                    return `- ${slot} | ${item.displayName}`;
                }
            });
            botInstance.logger.chat(outputLines.join('\n'));
        }
        botInstance.logger.chat(`------------------------------------`);

    } catch (error: any) {
        botInstance.logger.error(`處理 ${windowName} 視窗時發生錯誤: ${error.message}`);
        botInstance.logger.debug(error.stack);
    } finally {
        if (window && botInstance.client && botInstance.client.currentWindow && botInstance.client.currentWindow.id === window.id) {
            botInstance.client.closeWindow(window);
            botInstance.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉。 ---`);
        }
    }
}

async function takeItemFromWindow(botInstance: any, command: string, windowName: string, slot: number): Promise<void> {
    let window: any = null;
    try {
        window = await openWindow(botInstance, command, windowName);
        if (!window) return;

        const items = window.containerItems();
        const item = items.find((i: any) => i.slot === slot);

        if (!item) {
            botInstance.logger.error(`欄位 ${slot} 中沒有物品。`);
            if (botInstance.config.debugMode) {
                botInstance.logger.debug("可用的容器欄位:", items.map((i: any) => i.slot));
            }
            return;
        }

        botInstance.logger.info(`正在從 ${windowName} 的欄位 ${slot} 拿取 ${item.displayName}...`);
        await botInstance.client.clickWindow(slot, 0, 0);
        botInstance.logger.info(`✅ 已成功點擊欄位 ${slot}。`);

    } catch (error: any) {
        botInstance.logger.error(`從 ${windowName} 拿取物品時發生錯誤: ${error.message}`);
    } finally {
        if (window && botInstance.client && botInstance.client.currentWindow && botInstance.client.currentWindow.id === window.id) {
            await sleep(500);
            botInstance.client.closeWindow(window);
            botInstance.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉。 ---`);
        }
    }
}

async function interactiveWindowGui(botInstance: any, command: string, windowName: string, rl: readline.Interface): Promise<void> {
    let window: any = null;
    const bot = botInstance.client;
    if (!bot) {
        botInstance.logger.warn('機器人未連線，無法開啟 GUI。');
        return;
    }

    try {
        window = await openWindow(botInstance, command, windowName);
        if (!window) return;

        logger.unsetRl();
        rl.pause();

        const guiLoop = async () => {
            console.log(`\n${Colors.FgCyan}--- ${botInstance.config.botTag} 的 ${windowName} 互動介面 ---${Colors.Reset}`);
            const items = window.containerItems().filter((item: any) => item.name !== 'gray_stained_glass_pane');

            if (items.length === 0) {
                console.log('   -> 介面是空的。');
            } else {
                items.forEach((item: any) => {
                    const customName = getCustomName(item, botInstance);
                    const name = customName ? `${item.displayName} | ${customName}` : item.displayName;
                    console.log(`  [${String(item.slot).padStart(2, ' ')}] ${name} (x${item.count})`);
                });
            }
            console.log(`--------------------------------------------------`);

            const answer: string = await new Promise(resolve => {
                rl.question(`輸入要點擊的欄位編號，或輸入 'exit'/'e' 離開: `, resolve);
            });
            const trimmedAnswer = answer.trim().toLowerCase();

            if (trimmedAnswer === 'exit' || trimmedAnswer === 'e') {
                return;
            }

            const slot = parseInt(trimmedAnswer, 10);
            if (isNaN(slot)) {
                console.log(`${Colors.FgRed}無效的輸入，請輸入數字欄位編號。${Colors.Reset}`);
                await guiLoop();
                return;
            }

            const allContainerItems = window.containerItems();
            const itemToClick = allContainerItems.find((i: any) => i.slot === slot);

            if (!itemToClick) {
                console.log(`${Colors.FgYellow}欄位 ${slot} 是空的或無效。${Colors.Reset}`);
                if (botInstance.config.debugMode) {
                    console.log("Available slots:", allContainerItems.map((i: any) => i.slot));
                }
            } else {
                console.log(`${Colors.FgGreen}正在點擊欄位 ${slot} (${itemToClick.displayName})...${Colors.Reset}`);
                await bot.clickWindow(slot, 0, 0);
                await sleep(500);
            }

            await guiLoop();
        };

        await guiLoop();

    } catch (error: any) {
        botInstance.logger.error(`互動式 GUI 發生錯誤: ${error.message}`);
    } finally {
        if (window && bot.currentWindow && bot.currentWindow.id === window.id) {
            bot.closeWindow(window);
            botInstance.logger.info(`已關閉 ${windowName} 介面。`);
        }
        rl.resume();
        logger.setRl(rl);
        rl.prompt(true);
    }
}

async function rideVehicle(botInstance: any, vehicleName: string, friendlyName: string): Promise<void> {
    const bot = botInstance.client;
    if (!bot) {
        botInstance.logger.warn('機器人未連線，無法執行操作。');
        return;
    }

    // 尋找 10 格內最近的載具
    const vehicle = bot.nearestEntity((entity: any) =>
        entity.name && entity.name.toLowerCase().includes(vehicleName) && bot.entity.position.distanceTo(entity.position) < 10
    );

    if (!vehicle) {
        botInstance.logger.warn(`附近 10 格內沒有${friendlyName}。`);
        return;
    }

    try {
        await bot.mount(vehicle);
        botInstance.logger.info(`✅ 成功坐上${friendlyName}。`);
    } catch (error: any) {
        botInstance.logger.error(`坐上${friendlyName}時發生錯誤: ${error.message}`);
    }
}

function startConsole(botManager: Map<string, any>, botTagsByIndex: string[]) {
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
   mount <cart|boat> [@目標] - 騎乘附近的礦車或船
   dismount [@目標]     - 從坐騎上下來
   pos [@目標]          - 取得目前座標
   tps [@目標]          - 取得伺服器目前的 TPS (多種方法)
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
            const subCommand = cleanArgs[0]?.toLowerCase();

            if (!['cart', 'boat'].includes(subCommand)) {
                logger.error('無效的 mount 指令。支援 "cart" (礦車), "boat" (船)。');
                return;
            }

            for (const bot of targets) {
                if (bot.state.status !== 'ONLINE') {
                    bot.logger.warn('機器人未上線，無法騎乘。');
                    continue;
                }

                if (subCommand === 'cart') {
                    await rideVehicle(bot, 'minecart', '礦車');
                } else if (subCommand === 'boat') {
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
                    const pluginTps = await bot.tpsMonitor.getPluginTPS();
                    const packetTps = bot.tpsMonitor.getPacketTPS();
                    const physicsTps = bot.tpsMonitor.getPhysicsTPS();
                    const gameTimeTps = bot.tpsMonitor.getGameTimeTPS();

                    const formatTps = (tps: number) => (tps < 0 ? '錯誤' : tps.toFixed(2).padStart(5));

                    bot.logger.info(`伺服器 TPS - [插件]: ${formatTps(pluginTps)} | [封包]: ${formatTps(packetTps)} | [物理]: ${formatTps(physicsTps)} | [時間]: ${formatTps(gameTimeTps)}`);

                } catch (error: any) {
                    bot.logger.error(`取得 TPS 時發生錯誤: ${error.message}`);
                }
            }
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

module.exports = {
    startConsole,
    nbtToJson,
    openWindow,
    getCustomName,
    listWindowItems,
    takeItemFromWindow,
    interactiveWindowGui,
    rideVehicle
};
