import { BotOptions } from 'mineflayer';
import { Window } from 'prismarine-windows';

export interface CustomBotOptions extends BotOptions {
    botTag: string;
    host: string;
    port: number;
    username: string;
    enabled?: boolean;
    enableViewer?: boolean;
    viewerPort?: number;
    startWorkOnLogin?: boolean;
    enableItemDropDetection?: boolean;
    antiAfk?: {
        enabled: boolean;
        intervalMinutes: number;
    };
    reconnectOnDuplicateLogin?: {
        enabled: boolean;
        delayMinutes: number;
    };
    debugMode?: boolean;
    omenCheckInterval?: number;
    omenReapplyDelay?: number;
    server?: string; // Added this line
}

export interface ILogger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    chat: (...args: unknown[]) => void;
}

export interface IViewer {
    close: () => void;
}

export interface IEffect {
    id: number;
    amplifier: number;
    duration: number;
}

export interface IRaceResult {
    event: 'windowOpen' | 'chatError' | 'timeout' | 'disconnect';
    window?: Window;
    message?: string;
}

export interface IItemData {
    itemId?: number;
    blockId?: number;
    itemCount?: number;
}
