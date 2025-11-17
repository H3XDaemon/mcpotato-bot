import { logger, sleep, Colors } from './utils';
import { BotJava } from './bot'; // Import BotJava for type hinting
import * as readline from 'readline';
import { Window } from 'prismarine-windows';
import { Entity } from 'prismarine-entity';
import { Block } from 'prismarine-block';
import { ParsedItem } from './gui'; // Import ParsedItem

export async function listWindowItems(bot: BotJava, command: string, windowName: string): Promise<void> {
    if (bot.isGuiBusy) {
        bot.logger.warn(`無法執行 '${command}'，因為另一個介面操作正在進行中。`);
        return;
    }
    const gui = bot.gui;
    if (!gui) {
        bot.logger.error('GUI 管理器尚未初始化。');
        return;
    }

    let window: Window | null = null;
    bot.isGuiBusy = true;
    try {
        window = await gui.open(command);
        if (!window) return;

        const items = gui.getItems(window!).filter((item: ParsedItem) => item.name !== 'gray_stained_glass_pane');
        
        bot.logger.chat(`--- ${bot.config.botTag} 的 ${windowName} 物品列表 ---`);

        if (items.length === 0) {
            bot.logger.chat('   -> 介面內沒有可操作的物品。');
        } else {
            const outputLines = items.map((item: ParsedItem) => {
                const slot = `欄位: ${String(item.slot).padEnd(3)}`;
                const name = item.styledDisplayName || item.displayName;
                return `- ${slot} | ${name}`;
            });
            outputLines.forEach((line: string) => bot.logger.chat(line));
        }
        bot.logger.chat(`------------------------------------`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        bot.logger.error(`處理 ${windowName} 視窗時發生錯誤: ${message}`);
        if (error instanceof Error && error.stack) {
            bot.logger.debug(error.stack);
        }
    } finally {
        if (window && bot.client && bot.client.currentWindow?.id === window.id) {
            bot.client.closeWindow(window);
        }
        bot.isGuiBusy = false; // Release the lock
        bot.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉，鎖已釋放。 ---`);
    }
}

export async function takeItemFromWindow(bot: BotJava, command: string, windowName: string, slot: number): Promise<void> {
    if (bot.isGuiBusy) {
        bot.logger.warn(`無法執行 '${command}'，因為另一個介面操作正在進行中。`);
        return;
    }
    const gui = bot.gui;
    if (!gui) {
        bot.logger.error('GUI 管理器尚未初始化。');
        return;
    }

    let window: Window | null = null;
    bot.isGuiBusy = true;
    try {
        window = await gui.open(command);
        if (!window) return;

        const items = gui.getItems(window);
        const item = items.find((i: ParsedItem) => i.slot === slot);

        if (!item) {
            bot.logger.error(`欄位 ${slot} 中沒有物品。`);
            if (bot.config.debugMode) {
                bot.logger.debug("可用的容器欄位:", items.map((i: ParsedItem) => i.slot));
            }
            return;
        }

        const name = item.styledDisplayName || item.displayName;
        bot.logger.info(`正在從 ${windowName} 的欄位 ${slot} 拿取 ${name}...`);
        await gui.click(slot, 'left');
        bot.logger.info(`✅ 已成功點擊欄位 ${slot}。`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        bot.logger.error(`從 ${windowName} 拿取物品時發生錯誤: ${message}`);
    } finally {
        if (window && bot.client && bot.client.currentWindow?.id === window.id) {
            await sleep(500);
            bot.client.closeWindow(window);
        }
        bot.isGuiBusy = false; // Release the lock
        bot.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉，鎖已釋放。 ---`);
    }
}

export async function interactiveWindowGui(bot: BotJava, command: string, windowName: string, rl: readline.Interface): Promise<void> {
    if (bot.isGuiBusy) {
        bot.logger.warn(`無法執行 '${command}'，因為另一個介面操作正在進行中。`);
        return;
    }
    const gui = bot.gui;
    if (!gui) {
        bot.logger.error('GUI 管理器尚未初始化。');
        return;
    }

    let window: Window | null = null;
    bot.isGuiBusy = true;
    try {
        window = await gui.open(command);
        if (!window) return;

        logger.unsetRl();
        rl.pause();

        const guiLoop = async () => {
            console.log(`
${Colors.FgCyan}--- ${bot.config.botTag} 的 ${windowName} 互動介面 ---${Colors.Reset}`);
            const items = gui.getItems(window!).filter((item: ParsedItem) => item.name !== 'gray_stained_glass_pane');

            if (items.length === 0) {
                console.log('   -> 介面是空的。');
            } else {
                items.forEach((item: ParsedItem) => {
                    const name = item.styledDisplayName || item.displayName;
                    console.log(`  [${String(item.slot).padStart(2, ' ')}] ${name} (x${item.count})`);
                });
            }
            console.log(`--------------------------------------------------`);

            const answer: string = await new Promise(resolve => {
                rl.question(`輸入要點擊的欄位編號，或輸入 'exit'/'e' 離開: `, resolve);
            });
            const trimmedAnswer = answer.trim().toLowerCase();

            if (trimmedAnswer === 'exit' || trimmedAnswer === 'e') {
                return; // Exit the loop
            }

            const slot = parseInt(trimmedAnswer, 10);
            if (isNaN(slot)) {
                console.log(`${Colors.FgRed}無效的輸入，請輸入數字欄位編號。${Colors.Reset}`);
                await guiLoop();
                return;
            }

            const itemToClick = items.find((i: ParsedItem) => i.slot === slot);

            if (!itemToClick) {
                console.log(`${Colors.FgYellow}欄位 ${slot} 是空的或無效。${Colors.Reset}`);
            } else {
                console.log(`${Colors.FgGreen}正在點擊欄位 ${slot} (${itemToClick.displayName})...${Colors.Reset}`);
                await gui.click(slot, 'left');
                await sleep(500); // Wait for server to process
            }

            await guiLoop();
        };

        await guiLoop();

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        bot.logger.error(`互動式 GUI 發生錯誤: ${message}`);
    } finally {
        if (window && bot.client && bot.client.currentWindow?.id === window.id) {
            bot.client.closeWindow(window);
        }
        bot.isGuiBusy = false; // Release the lock
        rl.resume();
        logger.setRl(rl);
        rl.prompt(true);
        bot.logger.debug(`--- [DEBUG] ${windowName} 介面已關閉，鎖已釋放。 ---`);
    }
}

export async function rideVehicle(bot: BotJava, vehicleName: string, friendlyName: string): Promise<void> {
    const client = bot.client;
    if (!client) {
        bot.logger.warn('機器人未連線，無法執行操作。');
        return;
    }

    // 尋找 10 格內最近的載具
    const vehicle = client.nearestEntity((entity: Entity) =>
        entity.name != null && entity.name.toLowerCase().includes(vehicleName) && client.entity.position.distanceTo(entity.position) < 10
    );

    if (!vehicle) {
        bot.logger.warn(`附近 10 格內沒有${friendlyName}。`);
        return;
    }

    try {
        await client.mount(vehicle);
        bot.logger.info(`✅ 成功坐上${friendlyName}。`);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        bot.logger.error(`坐上${friendlyName}時發生錯誤: ${message}`);
    }
}

export async function waitForMinecartAndMount(bot: BotJava, maxDistance = 5): Promise<void> {
    if (bot.state.status !== 'ONLINE' || !bot.client) {
        logger.warn('機器人離線,無法執行等待礦車指令。');
        return;
    }

    const client = bot.client;
    logger.info(`正在等待半徑 ${maxDistance} 格內的礦車...`);

    // 1. Check for existing nearby minecart
    const nearestMinecart = client.nearestEntity(entity => {
        return entity.name === 'minecart' && client.entity.position.distanceTo(entity.position) <= maxDistance;
    });

    if (nearestMinecart) {
        logger.info(`偵測到已存在的礦車 (ID: ${nearestMinecart.id}),正在嘗試上車...`);
        try {
            await client.mount(nearestMinecart);
            logger.info('✅ 成功坐上礦車。');
            return;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`嘗試坐上礦車失敗: ${message}`);
            return;
        }
    }

    // 2. Wait for a minecart to spawn OR move into range
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            logger.warn('等待礦車超時 (2分鐘)。');
            reject(new Error('Waiting for minecart timed out after 2 minutes.'));
        }, 120000);

        const cleanup = () => {
            clearTimeout(timeout);
            client.removeListener('entitySpawn', onEntityEvent);
            client.removeListener('entityMoved', onEntityEvent);
        };

        const onEntityEvent = async (entity: Entity) => {
            if (entity.name === 'minecart' && client.entity.position.distanceTo(entity.position) <= maxDistance) {
                logger.info(`偵測到礦車 (ID: ${entity.id}),正在嘗試上車...`);
                cleanup();
                try {
                    await client.mount(entity);
                    logger.info('✅ 成功坐上礦車。');
                    resolve();
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    logger.error(`嘗試坐上礦車失敗: ${message}`);
                    reject(err);
                }
            }
        };

        client.on('entitySpawn', onEntityEvent);
        client.on('entityMoved', onEntityEvent);
    });
}

export async function activateLeverNearBlock(bot: BotJava, blockTypeName: string, maxDistanceToAnchor = 32, maxDistanceToLever = 5): Promise<void> {
    if (bot.state.status !== 'ONLINE' || !bot.client) {
        logger.warn('機器人離線，無法執行拉桿指令。');
        return;
    }

    const client = bot.client;
    const blockType = client.registry.blocksByName[blockTypeName];

    if (!blockType) {
        logger.error(`未知的方塊類型: '${blockTypeName}'`);
        return;
    }

    logger.info(`正在尋找半徑 ${maxDistanceToAnchor} 格內的 '${blockTypeName}' 方塊...`);
    const anchorBlock = await client.findBlock({
        matching: blockType.id,
        maxDistance: maxDistanceToAnchor
    });

    if (!anchorBlock) {
        logger.warn(`在附近找不到 '${blockTypeName}' 方塊。`);
        return;
    }
    logger.info(`找到 '${blockTypeName}' 方塊於 ${anchorBlock.position}。`);

    logger.info(`正在尋找 '${blockTypeName}' 附近 ${maxDistanceToLever} 格內的拉桿...`);
    const leverBlock = await client.findBlock({
        matching: client.registry.blocksByName.lever.id,
        maxDistance: maxDistanceToLever,
        point: anchorBlock.position
    });

    if (!leverBlock) {
        logger.warn(`在 '${blockTypeName}' 附近找不到拉桿。`);
        return;
    }
    logger.info(`找到拉桿於 ${leverBlock.position}。`);

    // Helper function to get lever state
    const getLeverState = (block: Block) => {
        if (client.supportFeature('blockStateId')) {
            return block.getProperties().powered;
        } else {
            return (block.metadata & 0x8) !== 0;
        }
    };

    const initialPoweredState = getLeverState(leverBlock);
    logger.info(`拉桿初始狀態: ${initialPoweredState ? '開啟' : '關閉'}`);

    try {
        await client.activateBlock(leverBlock);
        logger.info('✅ 成功切換拉桿。');

        // Wait for block update to propagate
        await sleep(500); // Wait 0.5 seconds, similar to client.waitForTicks(2)

        const updatedLeverBlock = client.blockAt(leverBlock.position);
        if (updatedLeverBlock && updatedLeverBlock.name === 'lever') {
            const finalPoweredState = getLeverState(updatedLeverBlock);
            logger.info(`拉桿切換後狀態: ${finalPoweredState ? '開啟' : '關閉'}`);
        } else {
            logger.warn('切換後無法重新獲取拉桿方塊狀態。');
        }

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`切換拉桿失敗: ${message}`);
    }
}

export async function findAndReportLevers(bot: BotJava, radius = 10): Promise<string[]> {
    if (!bot.client) {
        logger.warn('機器人離線，無法掃描拉桿。');
        return ['機器人離線，無法掃描拉桿。'];
    }
    const client = bot.client;

    logger.info(`正在掃描半徑 ${radius} 格內的拉桿...`);
    const levers = await client.findBlocks({
        matching: client.registry.blocksByName.lever.id,
        maxDistance: radius,
        count: 20 // Limit to 20 levers
    });

    if (levers.length === 0) {
        bot.lastScannedLevers = [];
        return ["附近沒有找到任何拉桿。"];
    }

    bot.lastScannedLevers = []; // Clear previous scan
    const reportLines: string[] = [];

    for (const leverPos of levers) {
        const leverBlock = client.blockAt(leverPos);
        if (!leverBlock) continue;

        const isPowered = (client.supportFeature('blockStateId'))
            ? leverBlock.getProperties().powered
            : (leverBlock.metadata & 0x8) !== 0;
        const stateStr = isPowered ? '開啟' : '關閉';

        bot.lastScannedLevers.push(leverBlock);
        const index = bot.lastScannedLevers.length;

        reportLines.push(`[${index}] 拉桿於 (${leverBlock.position.x}, ${leverBlock.position.y}, ${leverBlock.position.z}) - 狀態: ${stateStr}`);
    }

    return reportLines;
}

export async function activateLeverByIndex(bot: BotJava, index: number): Promise<void> {
    if (!bot.client) {
        logger.warn('機器人離線，無法啟動拉桿。');
        return;
    }

    const leverIndex = index - 1; // User sees 1-based, array is 0-based
    if (leverIndex < 0 || leverIndex >= bot.lastScannedLevers.length) {
        logger.error(`無效的拉桿編號: ${index}。請先執行 'lever' 指令掃描。`);
        return;
    }

    const leverBlock = bot.lastScannedLevers[leverIndex];
    logger.info(`正在啟動編號 ${index} 的拉桿於 ${leverBlock.position}...`);
    
    // Reuse the state checking logic
    const client = bot.client;
    const getLeverState = (block: Block) => {
        if (client.supportFeature('blockStateId')) {
            return block.getProperties().powered;
        } else {
            return (block.metadata & 0x8) !== 0;
        }
    };

    const initialPoweredState = getLeverState(leverBlock);
    logger.info(`拉桿初始狀態: ${initialPoweredState ? '開啟' : '關閉'}`);

    try {
        await client.activateBlock(leverBlock);
        logger.info('✅ 成功切換拉桿。');

        await sleep(500);

        const updatedLeverBlock = client.blockAt(leverBlock.position);
        if (updatedLeverBlock && updatedLeverBlock.name === 'lever') {
            const finalPoweredState = getLeverState(updatedLeverBlock);
            logger.info(`拉桿切換後狀態: ${finalPoweredState ? '開啟' : '關閉'}`);
        } else {
            logger.warn('切換後無法重新獲取拉桿方塊狀態。');
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`切換拉桿失敗: ${message}`);
    }
}