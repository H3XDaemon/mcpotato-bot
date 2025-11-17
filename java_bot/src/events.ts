import { Window } from 'prismarine-windows';
import { IEffect, IRaceResult, IItemData } from './interfaces';
import { Entity } from 'prismarine-entity';
import { BotJava } from "./bot";
import { ChatMessage } from 'prismarine-chat';
import * as util from 'util';
import { sleep } from "./utils";
import { takeItemFromWindow } from './actions.js';

function isItemData(value: unknown): value is IItemData {
    return typeof value === 'object' && value !== null && ('itemId' in value || 'blockId' in value);
}


export function setupEventListeners(bot: BotJava) {
    if (!bot.client) return;

    bot.client.on('login', () => {
        if (!bot.client) return;
        bot.state.status = 'ONLINE';
        const connectedServer = bot.serverList[bot.currentServerIndex];
        const serverTag = bot.currentServerIndex === 0 ? '主要' : `備用-${bot.currentServerIndex}`;
        bot.logger.info(`✅ 成功登入到 [${serverTag}] 伺服器 ${connectedServer.host}:${connectedServer.port}，玩家名稱: ${bot.client.username}`);
        
        // ++ 新增 ++ 成功連線後，從黑名單中移除
        const serverIdentifier = `${connectedServer.host}:${connectedServer.port}`;
        if (bot.ipBlacklist.has(serverIdentifier)) {
            bot.ipBlacklist.delete(serverIdentifier);
            bot.logger.info(`已將 ${serverIdentifier} 從連線黑名單中移除。`);
        }



        bot.lastSuccessfulLoginTime = Date.now();
        bot.consecutiveConnectionFails = 0;
        bot.reconnectContext = 'NONE'; // Reset context on successful login
        bot.connectionGlitchHandled = false;

        if (bot.tpsMonitor) {
            bot.tpsMonitor.start();
        }

        if (bot.config.antiAfk?.enabled) { // Added null/undefined check
            if (bot.antiAfkInterval) clearInterval(bot.antiAfkInterval);
            bot.antiAfkInterval = setInterval(async () => {
                if (bot.state.status !== 'ONLINE' || !bot.client || bot.isGuiBusy) {
                    if (bot.isGuiBusy) {
                        bot.logger.info('[Anti-AFK] 偵測到介面正在使用中，跳過本次操作。');
                    } else if (bot.state.status !== 'ONLINE') {
                        bot.logger.warn(`[Anti-AFK] 跳過操作，因為機器人狀態為 ${bot.state.status} 而非 ONLINE。`);
                    }
                    return;
                }
        
                bot.isGuiBusy = true;
                bot.logger.info('[Anti-AFK] 執行開啟並關閉 /ah 來重置計時器...');
                const currentClient = bot.client; // Capture the client instance at this moment.

                try {
                    currentClient.chat('/ah'); // <<<< 執行指令
                    // 使用 Promise.race 來處理多種可能的回應
                    const raceResult: IRaceResult = await Promise.race([ // Explicitly cast
                        // 1. 成功開啟視窗
                        new Promise<IRaceResult>((resolve) => {
                            const onWindowOpen = (win: Window) => {
                                currentClient.removeListener('end', onEnd);
                                resolve({ event: 'windowOpen', window: win });
                            };
                            const onEnd = () => {
                                currentClient.removeListener('windowOpen', onWindowOpen);
                                resolve({ event: 'disconnect' });
                            };
                            currentClient.once('windowOpen', onWindowOpen);
                            currentClient.once('end', onEnd);
                        }),
                        // 2. 收到錯誤訊息
                        new Promise<IRaceResult>((resolve) => {
                            const keywords = ['錯誤', '等待', '冷卻', 'error', 'wait', 'cooldown'];
                            const onMessage = (jsonMsg: ChatMessage) => {
                                const text = jsonMsg.toString().toLowerCase();
                                if (keywords.some(k => text.includes(k))) {
                                    currentClient.removeListener('end', onEnd);
                                    currentClient.removeListener('message', onMessage);
                                    resolve({ event: 'chatError', message: jsonMsg.toAnsi() });
                                }
                            };
                            const onEnd = () => {
                                currentClient.removeListener('message', onMessage);
                                resolve({ event: 'disconnect' });
                            };
                            currentClient.on('message', onMessage);
                            currentClient.once('end', onEnd);
                        }),
                        // 3. 超時
                        new Promise<IRaceResult>((resolve) => {
                            setTimeout(() => resolve({ event: 'timeout' }), 10000);
                        })
                    ]);

                    // 根據 race 的結果進行處理
                    switch (raceResult.event) {
                        case 'windowOpen':
                            bot.logger.info('[Anti-AFK] /ah 視窗已成功開啟。');
                            await sleep(1000); // Wait a second before closing
                            if (raceResult.window) {
                                currentClient.closeWindow(raceResult.window);
                            }
                            bot.logger.info('[Anti-AFK] /ah 介面已成功關閉。');
                            break;
                        case 'chatError':
                            throw new Error(`伺服器返回了可能的錯誤訊息: ${raceResult.message}`);
                        case 'timeout':
                            throw new Error('等待 /ah 視窗開啟或錯誤訊息超時 (10秒)');
                        case 'disconnect':
                            bot.logger.warn('[Anti-AFK] 操作在執行中斷線，已取消。');
                            break;
                        default:
                            throw new Error('未知的 Anti-AFK 競態結果');
                    }

                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    bot.logger.error(`[Anti-AFK] 操作失敗: ${message}`);
                    // If an error occurs, it's possible a window is stuck open.
                    if (currentClient && currentClient.currentWindow) {
                        bot.logger.warn('[Anti-AFK] 嘗試關閉可能殘留的視窗...');
                        try { currentClient.closeWindow(currentClient.currentWindow); } catch {}
                    }
                } finally {
                    bot.isGuiBusy = false;
                }
            }, (bot.config.antiAfk?.intervalMinutes || 4) * 60 * 1000); // Added null/undefined check
            bot.logger.info(`Anti-AFK 功能已更新為執行 /ah 指令，每 ${(bot.config.antiAfk?.intervalMinutes || 4)} 分鐘執行一次。`); // Added null/undefined check
        }
    });

    bot.client.on('spawn', async () => {
        if (!bot.client) return;
        bot.logger.info('機器人已在遊戲世界中生成。');

        // Add a delay before starting work to allow for full state synchronization (effects, inventory, etc.)
        bot.logger.info('等待 5 秒以確保客戶端狀態同步...');
        await sleep(5000);

        if (!bot.client) { // Re-check client status after sleep
            bot.logger.warn('機器人在同步等待期間斷線，已中止 spawn 相關操作。');
            return;
        }

        bot.logger.info(`目前位置: ${bot.client.entity.position}`);

        // Start work mode after spawning to ensure inventory is loaded
        if (bot.config.startWorkOnLogin && !bot.isWorking) {
            bot.startWork();
        }

        if (bot.config.enableViewer) {
            // Dynamically import viewer dependencies only when needed
            try {
                const viewerModule = (await import('prismarine-viewer')).mineflayer;
                const { Canvas } = await import('canvas');
                await bot.startViewer(viewerModule, { Canvas });
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                bot.logger.error(`無法加載監看視窗模組: ${message}`);
                bot.logger.warn('請執行 "npm install prismarine-viewer canvas" 來安裝監看視窗的依賴。');
                bot.config.enableViewer = false;
            }
        }
    });

    bot.client.on('entityEffect', async (entity: Entity, effect: IEffect) => {
        const client = bot.client;
        if (!client) return;
        if (entity === client.entity) {
            const mcDataFactory = (await import('minecraft-data')).default;
            const mcData = mcDataFactory(client.version);
            const effectName = Object.keys(mcData.effectsByName).find(name =>
                mcData.effectsByName[name].id === effect.id
            );

            const previousEffect = bot.lastKnownEffects.get(effect.id);
            if (!previousEffect || previousEffect.amplifier !== effect.amplifier) {
                const action = !previousEffect ? "獲得" :
                    effect.amplifier > previousEffect.amplifier ? "等級提升為" :
                        effect.amplifier < previousEffect.amplifier ? "等級變為" : "等級變為";
                const name = effectName || `未知效果 (ID: ${effect.id})`;

                bot.logger.info(`[狀態更新] ${action}效果: ${name} (等級: ${effect.amplifier + 1})`);
            }

            bot.lastKnownEffects.set(effect.id, { id: effect.id, amplifier: effect.amplifier, duration: effect.duration }); // Added duration
        }
    });
    
    bot.client.on('entityEffectEnd', async (entity: Entity, effect: IEffect) => {
        const client = bot.client;
        if (!client) return;
        if (entity === client.entity && bot.lastKnownEffects.has(effect.id)) {
            const mcDataFactory = (await import('minecraft-data')).default;
            const mcData = mcDataFactory(client.version);
            const effectName = Object.keys(mcData.effectsByName).find(name =>
                mcData.effectsByName[name].id === effect.id
            );
            const name = effectName || `未知效果 (ID: ${effect.id})`;
            bot.logger.info(`[狀態更新] 效果已結束: ${name}`);

            bot.lastKnownEffects.delete(effect.id);
            
            if (bot.isWorking && ['TrialOmen', 'BadOmen'].includes(effectName as string)) {
                bot.logger.info('偵測到 Omen 效果結束，立即安排一次快速檢查...');
                
                if (bot.workTimeout) clearTimeout(bot.workTimeout);
                
                bot.workTimeout = setTimeout(() => bot.maintainOmenEffect(), bot.config.omenReapplyDelay);
            }
        }
    });

    bot.client.on('itemDrop', (entity: Entity,) => {
        const client = bot.client;
        if (!client || !bot.config.enableItemDropDetection) return;
        if (!entity || !entity.metadata) return;

        // ++ 修改 ++ 檢查此掉落物實體是否已被處理
        if (bot.processedDropEntities.has(entity.id)) {
            bot.logger.debug(`[掉落物] 忽略已處理的掉落物實體: ${entity.id}`);
            return;
        }
        
        //bot.logger.info(`🎯 itemDrop 事件觸發！實體ID: ${entity.id}, 名稱: ${entity.name}`);
        if (bot.config.debugMode) {
             bot.logger.debug(`完整 metadata: ${util.inspect(entity.metadata, { depth: null })}`);
        }

        try {
            let itemData: IItemData | undefined;
            let slotPosition: number;

            // ++ 修改 ++ 根據日誌和版本特性，更精準地判斷 slot 位置
            if (client.supportFeature('itemsAreAlsoBlocks')) { // < 1.13
                slotPosition = 6;
            } else { // >= 1.13
                const majorVersion = parseInt(client.version.split('.')[1]);
                if (client.majorVersion === '1.13') {
                    slotPosition = 6;
                } else if (majorVersion >= 20) { // 適用於 1.20, 1.21+
                    slotPosition = 9;
                } else { // 適用於 1.14 -> 1.19
                    slotPosition = 7;
                }
            }

            const metadataValue = entity.metadata[slotPosition];
            if (isItemData(metadataValue)) {
                itemData = metadataValue;
            }


            if (!itemData) {
                bot.logger.warn(`[掉落物] 在預期的 metadata[${slotPosition}] 中找不到物品數據，將嘗試遍歷搜尋...`);
                for (const [key, value] of Object.entries(entity.metadata)) {
                    if (isItemData(value)) {
                        bot.logger.info(`[掉落物] 在 metadata[${key}] 找到備用物品數據！`);
                        itemData = value;
                        break; 
                    }
                    
                }
            }
            
            if (!itemData) {
                bot.logger.error(`[掉落物] 錯誤：在所有 metadata 中都找不到有效的物品數據。`);
                return;
            }
            
            // 兼容舊版 (blockId) 來獲取物品 ID。
            const itemId = itemData.itemId === undefined ? itemData.blockId : itemData.itemId;
            const itemCount = itemData.itemCount || 1;

            if (itemId === undefined) return;

            const item = client.registry.items[itemId];
            if (!item) {
                bot.logger.warn(`[掉落物] 根據 ID ${itemId} 找不到對應的物品信息。`);
                return;
            }

            const itemName = item.displayName;
            const internalName = item.name;
            const position = entity.position.floored();

            if (internalName === 'ominous_trial_key' || bot.config.debugMode) {
                bot.logger.info(`[掉落物] 偵測到物品: ${itemName} (數量: ${itemCount}) 在座標 (X: ${position.x}, Y: ${position.y}, Z: ${position.z})`);
            }
            
            // ++ 新增 ++ 成功處理後，將實體ID加入集合中
            bot.processedDropEntities.add(entity.id);
            
            if (internalName === 'ominous_trial_key') {
                bot.ominousTrialKeyDrops += itemCount;
                bot.logger.info(`[戰利品] ominous_trial_key 掉落了 ${itemCount} 個，目前總計: ${bot.ominousTrialKeyDrops}`);
            }

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            bot.logger.error(`處理掉落物時發生錯誤: ${message}`);
            if (error instanceof Error && error.stack) {
                bot.logger.debug(error.stack);
            }
        }
    });

    bot.client.on('entityGone', (entity: Entity,) => {
        // ++ 新增 ++ 當掉落物實體消失時，從集合中移除，釋放記憶體
        if (bot.processedDropEntities.has(entity.id)) {
            bot.processedDropEntities.delete(entity.id);
            bot.logger.debug(`[掉落物] 已從追蹤列表中移除實體: ${entity.id}`);
        }
    });

    bot.client.on('entitySpawn', (entity: Entity,) => {
        if (bot.config.debugMode && entity.name && (entity.name.toLowerCase() === 'item' || entity.name.toLowerCase() === 'item_stack')) {
            bot.logger.info(`🔍 偵測到掉落物實體生成 (名稱: ${entity.name}, ID: ${entity.id})`);
            bot.logger.debug(`[掉落物偵錯-SPAWN] 實體位於 ${entity.position.floored()}`);
        }
    });

    bot.client.on('message', (jsonMsg: ChatMessage, position: string) => {
        if (!bot.client) return;
        try {
            const messageText = jsonMsg.toString();

            if (
                'color' in jsonMsg && (jsonMsg as { color?: string }).color === 'red' && // Added type assertion
                messageText.includes('You are already trying to connect to a server!') &&
                !bot.connectionGlitchHandled
            ) {
                bot.logger.warn('偵測到因伺服器重啟造成的連線狀態鎖死，將強制斷線並依正常程序重連。');
                bot.connectionGlitchHandled = true;
                bot.onDisconnected('connection_glitch', 'Forced disconnect due to server restart lock-up.');
                return;
            }

            if (position === 'game_info') {
                if (messageText.includes('earned') || messageText.includes('上線5分鐘派發金錢')) {
                    return;
                }
            }
            const cleanMessageText = messageText.replace(/§[0-9a-fk-or]/g, '');

            // ++ TPA Whitelist Logic ++
            const tpaRequestMatch = cleanMessageText.match(/^(.+?) 請求您傳送過去。/); // Player wants bot to go to them
            const tpaHereRequestMatch = cleanMessageText.match(/^(.+?) 請求傳送過來。/); // Player wants to come to bot

            let playerName: string | null = null;
            let permissionType: 'allowTpa' | 'allowTpaHere' | null = null;
            let requestTypeLog = '';

            if (tpaRequestMatch) {
                playerName = tpaRequestMatch[1].toLowerCase();
                permissionType = 'allowTpa';
                requestTypeLog = `傳送過去 (${tpaRequestMatch[1]})`;
            } else if (tpaHereRequestMatch) {
                playerName = tpaHereRequestMatch[1].toLowerCase();
                permissionType = 'allowTpaHere';
                requestTypeLog = `傳送過來 (${tpaHereRequestMatch[1]})`;
            }

            if (playerName && permissionType) {
                const permissions = bot.tpaWhitelist.get(playerName);
                if (permissions && permissions[permissionType]) {
                    bot.logger.info(`[TPA] 偵測到白名單玩家的請求: ${requestTypeLog}，權限符合，將自動接受。`);
                    // A small delay to mimic human reaction and avoid potential server-side race conditions
                    setTimeout(() => {
                        bot.runCommand('/tpyes');
                    }, 1500);
                } else {
                    bot.logger.info(`[TPA] 偵測到玩家請求: ${requestTypeLog}，但該玩家不在白名單或無此權限，將不予理會。`);
                }
            }
            // -- End TPA Whitelist Logic --

            if (cleanMessageText.includes('達到在線賺錢上限')) {
                bot.logger.info('偵測到「達到在線賺錢上限」訊息，將自動提款...');
                setTimeout(() => {
                    takeItemFromWindow(bot, '/atm', '虛擬銀行 (ATM)', 9);
                }, 1500);
            }

            bot.logger.chat(jsonMsg.toAnsi());
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            bot.logger.warn('攔截到一個可忽略的聊天封包解析錯誤，已忽略以維持連線穩定。');
            bot.logger.debug(`錯誤詳情: ${message}`);
        }
    });

    bot.client.on('kicked', (reason: string, _loggedIn: boolean) => bot.onDisconnected('kicked', reason));

    // Non-fatal errors are logged here, but do not trigger a disconnect.
    // The 'end' event will handle the actual disconnection if it occurs.
    bot.client.on('error', (err: Error) => {
        bot.logger.error(`客戶端錯誤: ${err.message}`);
    });

    bot.client.on('end', (reason: string) => bot.onDisconnected('end', reason));

    bot.client.on('experience', () => {
        if (!bot.client || !bot.logExpRate) return;
        const MINUTE_WINDOW_SIZE = 60000;
        const SAMPLE_INTERVAL = 60000; // 每分鐘取樣一次
        const LOG_INTERVAL = 5000;
        const now = Date.now();
        const currentPoints = bot.client.experience.points;

        // 更新一分鐘滑動窗口 (用於即時速率)
        bot.expHistory.push({ time: now, points: currentPoints });
        while (bot.expHistory.length > 0 && now - bot.expHistory[0].time > MINUTE_WINDOW_SIZE) {
            bot.expHistory.shift();
        }

        // 每分鐘取樣一次 (用於長期統計)
        if (now - bot.lastExpSampleTime > SAMPLE_INTERVAL) {
            bot.lastExpSampleTime = now;
            bot.expSamplesHour.push({ time: now, points: currentPoints });
            // 維持最多65個樣本 (約一小時多一點)
            if (bot.expSamplesHour.length > 65) {
                bot.expSamplesHour.shift();
            }
        }

        // 計算並記錄 exp/h (基於一分鐘窗口)
        if (bot.expHistory.length >= 2 && (now - bot.lastExpLogTime > LOG_INTERVAL)) {
            const oldest = bot.expHistory[0];
            const newest = bot.expHistory[bot.expHistory.length - 1];

            const timeDiffMs = newest.time - oldest.time;
            const pointsDiff = newest.points - oldest.points;

            if (timeDiffMs > 0) {
                const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
                const expPerHour = pointsDiff / timeDiffHours;

                bot.logger.info(`exp/h (滑動1分鐘窗口): ${expPerHour.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
                bot.lastExpLogTime = now;
            }
        }
    });
}