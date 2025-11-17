import mineflayer from 'mineflayer';
import { logger } from './utils';

export class TPSMonitor {
    bot: any;
    packetTpsValues: number[];
    lastPacketTime: number;
    tickTimes: number[];
    lastTickTime: number;
    physicsTPS: number;
    tpsHistory: number[];
    lastGameTime: bigint;
    lastRealTime: number;
    gameTimeInterval: NodeJS.Timeout | null;

    constructor(bot: mineflayer.Bot) {
        this.bot = bot;

        // --- 1. Network Packet Method ---
        this.packetTpsValues = [];
        this.lastPacketTime = Date.now();
        if (this.bot && this.bot._client) {
            this.bot._client.on('update_time', () => this.onTimeUpdate());
        }

        // --- 2. Physics Tick Method ---
        this.tickTimes = [];
        this.lastTickTime = Date.now();
        this.physicsTPS = 20.0;
        this.bot.on('physicsTick', () => this.onPhysicsTick());

        // --- 3. Game Time Method ---
        this.tpsHistory = [];
        this.lastGameTime = 0n;
        this.lastRealTime = Date.now();
        this.gameTimeInterval = null;
    }

    start() {
        // This method is called safely after the bot has spawned
        if (this.bot.time && typeof this.bot.time.bigTime !== 'undefined') {
            this.lastGameTime = this.bot.time.bigTime;
            this.lastRealTime = Date.now();
            if (!this.gameTimeInterval) { // Prevent creating multiple intervals
                this.gameTimeInterval = setInterval(() => this.calculateGameTimeTPS(), 1000);
            }
        } else {
            logger.warn('TPSMonitor: bot.time is not available on start(). Game Time TPS method will be disabled.');
        }
    }

    // --- Network Packet Logic ---
    onTimeUpdate() {
        const now = Date.now();
        const timeElapsed = (now - this.lastPacketTime) / 1000;
        if (timeElapsed > 0) {
            const tps = Math.min(20.0, 20.0 / timeElapsed);
            this.packetTpsValues.push(tps);
            if (this.packetTpsValues.length > 20) this.packetTpsValues.shift();
        }
        this.lastPacketTime = now;
    }
    getPacketTPS() {
        if (this.packetTpsValues.length === 0) return 20.0;
        return this.packetTpsValues.reduce((a: number, b: number) => a + b) / this.packetTpsValues.length;
    }

    // --- Physics Tick Logic ---
    onPhysicsTick() {
        const now = Date.now();
        const deltaTime = now - this.lastTickTime;
        this.tickTimes.push(deltaTime);
        if (this.tickTimes.length > 100) this.tickTimes.shift();
        if (this.tickTimes.length >= 20) {
            const avgDeltaTime = this.tickTimes.reduce((a: number, b: number) => a + b) / this.tickTimes.length;
            this.physicsTPS = Math.min(20, 1000 / avgDeltaTime);
        }
        this.lastTickTime = now;
    }
    getPhysicsTPS() {
        return this.physicsTPS;
    }

    // --- Game Time Logic ---
    calculateGameTimeTPS() {
        // Safety check in case this is called before `start`
        if (!this.bot.time || !this.bot.time.bigTime || this.lastGameTime === null) return;

        const currentGameTime = this.bot.time.bigTime;
        const currentRealTime = Date.now();
        const gameTimeDiff = Number(BigInt(currentGameTime) - BigInt(this.lastGameTime));
        const realTimeDiff = currentRealTime - this.lastRealTime;

        if (realTimeDiff > 0) {
            const tps = (gameTimeDiff / realTimeDiff) * 1000;
            this.tpsHistory.push(Math.min(20, tps));
            if (this.tpsHistory.length > 60) this.tpsHistory.shift();
        }
        this.lastGameTime = currentGameTime;
        this.lastRealTime = currentRealTime;
    }
    getGameTimeTPS() {
        if (this.tpsHistory.length === 0) return 20.0;
        return this.tpsHistory.reduce((a: number, b: number) => a + b) / this.tpsHistory.length;
    }
    
    // --- Cleanup ---
    stop() {
        if (this.gameTimeInterval) {
            clearInterval(this.gameTimeInterval);
            this.gameTimeInterval = null;
        }
    }
}
