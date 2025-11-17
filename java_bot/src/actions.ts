import { logger, sleep } from './utils';
import { BotJava } from './bot'; // Import BotJava for type hinting

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
        } catch (err: any) {
            logger.error(`嘗試坐上礦車失敗: ${err.message}`);
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

        const onEntityEvent = async (entity: any) => {
            if (entity.name === 'minecart' && client.entity.position.distanceTo(entity.position) <= maxDistance) {
                logger.info(`偵測到礦車 (ID: ${entity.id}),正在嘗試上車...`);
                cleanup();
                try {
                    await client.mount(entity);
                    logger.info('✅ 成功坐上礦車。');
                    resolve();
                } catch (err: any) {
                    logger.error(`嘗試坐上礦車失敗: ${err.message}`);
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
    const getLeverState = (block: any) => {
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

    } catch (err: any) {
        logger.error(`切換拉桿失敗: ${err.message}`);
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
    const getLeverState = (block: any) => {
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
    } catch (err: any) {
        logger.error(`切換拉桿失敗: ${err.message}`);
    }
}
