
import { BotJava } from './bot.js';
import { BotTask } from './task.js';
import { sleep } from './utils.js';

/**
 * A sample task for interacting with the Auction House.
 */
export const auctionHouseTask: BotTask = {
    name: 'AuctionHouseScanner',
    async execute(bot: BotJava): Promise<void> {
        const gui = bot.gui;
        if (!gui || !bot.client || bot.isGuiBusy) {
            if (bot.isGuiBusy) bot.logger.debug(`[${this.name}] GUI is busy, skipping execution.`);
            return;
        }

        bot.isGuiBusy = true;
        bot.logger.info(`[${this.name}] Starting scan...`);
        let window: any = null;
        try {
            // Pre-emptive close for any stuck windows
            if (bot.client.currentWindow) {
                bot.logger.warn(`[${this.name}] A window was already open. Closing it before starting.`);
                bot.client.closeWindow(bot.client.currentWindow);
                await sleep(500); // Give server time to process close
            }

            window = await gui.open('/ah');
            const items = gui.getItems(window);
            bot.logger.info(`[${this.name}] Found ${items.length} items on the first page.`);
            // TODO: Add logic to find specific items or navigate pages.
        } catch (err: any) {
            bot.logger.error(`[${this.name}] Error during execution: ${err.message}`);
        } finally {
            if (window && bot.client && bot.client.currentWindow?.id === window.id) {
                bot.client.closeWindow(window);
            }
            bot.isGuiBusy = false;
            bot.logger.info(`[${this.name}] Scan finished.`);
        }
    }
};

/**
 * A sample task for interacting with Player Warps.
 */
export const playerWarpTask: BotTask = {
    name: 'PlayerWarpScanner',
    async execute(bot: BotJava): Promise<void> {
        const gui = bot.gui;
        if (!gui || !bot.client || bot.isGuiBusy) {
            if (bot.isGuiBusy) bot.logger.debug(`[${this.name}] GUI is busy, skipping execution.`);
            return;
        }

        bot.isGuiBusy = true;
        bot.logger.info(`[${this.name}] Starting scan...`);
        let window: any = null;
        try {
            // Pre-emptive close for any stuck windows
            if (bot.client.currentWindow) {
                bot.logger.warn(`[${this.name}] A window was already open. Closing it before starting.`);
                bot.client.closeWindow(bot.client.currentWindow);
                await sleep(500); // Give server time to process close
            }

            window = await gui.open('/pw');
            const items = gui.getItems(window);
            bot.logger.info(`[${this.name}] Found ${items.length} player warps.`);
            // TODO: Add logic to find specific warps.
        } catch (err: any) {
            bot.logger.error(`[${this.name}] Error during execution: ${err.message}`);
        } finally {
            if (window && bot.client && bot.client.currentWindow?.id === window.id) {
                bot.client.closeWindow(window);
            }
            bot.isGuiBusy = false;
            bot.logger.info(`[${this.name}] Scan finished.`);
        }
    }
};
