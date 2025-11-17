import { BotOptions } from 'mineflayer';

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
}
