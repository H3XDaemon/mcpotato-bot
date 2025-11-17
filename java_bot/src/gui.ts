
import { Bot } from 'mineflayer';
import { Item } from 'prismarine-item';
const ChatMessage = require('prismarine-chat');
import { sleep, nbtToJson } from './utils.js';

// Interface for a parsed item, including its styled name and lore
export interface ParsedItem {
    slot: number;
    id: number;
    name: string; // Internal name, e.g., 'diamond_sword'
    displayName: string; // Base display name
    styledDisplayName: string | null; // Name with § codes (as ANSI string)
    styledLore: string[] | null; // Lore with § codes, each line as an ANSI string
    count: number;
    originalItem: Item; // The original prismarine-item object
}

export class GuiManager {
    private bot: Bot;
    private chatParser: any;

    constructor(bot: Bot) {
        this.bot = bot;
        this.chatParser = ChatMessage(this.bot.registry);
    }

    public async open(command: string, timeout: number = 10000): Promise<any> {
        // Pre-emptively close any potentially stuck window
        if (this.bot.currentWindow) {
            this.bot.closeWindow(this.bot.currentWindow);
            await sleep(250); // Give the server a moment to process the close packet
        }

        this.bot.chat(command);

        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            // Poll for the new window to be set. Ignore player inventory (id 0).
            if (this.bot.currentWindow && this.bot.currentWindow.id !== 0) {
                const window = this.bot.currentWindow;
                // Now, wait for items to appear in that window
                const pollingStartItems = Date.now();
                while (Date.now() - pollingStartItems < 5000) { // Wait up to 5s for items
                    if (window.containerItems().length > 0) {
                        return window;
                    }
                    await sleep(250);
                }
                return window; // Return even if empty
            }
            await sleep(100); // Polling interval
        }

        throw new Error(`Window open timed out after ${timeout}ms: No new window was detected.`);
    }

    public async click(slot: number, button: 'left' | 'right'): Promise<void> {
        const mouseButton = button === 'left' ? 0 : 1;
        await this.bot.clickWindow(slot, mouseButton, 0);
    }

    private parseItemNbt(item: Item): { styledDisplayName: string | null; styledLore: string[] | null } {
        if (!item || !item.nbt) {
            return { styledDisplayName: null, styledLore: null };
        }

        const simpleNbt = nbtToJson(item.nbt);
        const displayData = simpleNbt?.display;

        if (!displayData) {
            return { styledDisplayName: null, styledLore: null };
        }

        let styledDisplayName: string | null = null;
        if (displayData.Name) {
            try {
                // Name is a JSON string, so it needs to be parsed first
                const nameJson = JSON.parse(displayData.Name);
                styledDisplayName = new this.chatParser(nameJson).toAnsi();
            } catch (e) {
                // Fallback for non-JSON names or parse errors
                styledDisplayName = displayData.Name;
            }
        }

        let styledLore: string[] | null = null;
        if (displayData.Lore && Array.isArray(displayData.Lore)) {
            styledLore = displayData.Lore.map((loreLine: string) => {
                try {
                    const loreJson = JSON.parse(loreLine);
                    return new this.chatParser(loreJson).toAnsi();
                } catch (e) {
                    // Fallback for non-JSON lore lines
                    return loreLine;
                }
            });
        }

        return { styledDisplayName, styledLore };
    }

    public getItems(window: any): ParsedItem[] {
        const items = window.containerItems() as Item[];
        if (!items) return [];

        return items.map(item => {
            const { styledDisplayName, styledLore } = this.parseItemNbt(item);
            return {
                slot: item.slot,
                id: item.type,
                name: item.name,
                displayName: item.displayName,
                styledDisplayName: styledDisplayName,
                styledLore: styledLore,
                count: item.count,
                originalItem: item,
            };
        });
    }
}
