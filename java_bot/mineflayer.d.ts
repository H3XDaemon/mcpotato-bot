import { Bot } from 'mineflayer';

declare module 'mineflayer' {
    interface Bot {
        viewer: any;
    }
}
