import mineflayer from 'mineflayer';
import { logger } from './utils';

export class TPSMonitor {
    bot: mineflayer.Bot;
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
            // This listener is for the 'keep_alive' packet, which is a good indicator of network latency.
            // However, 'update_time' is more directly related to the server's game loop.
            this.bot._client.on('update_time', () => this.onTimeUpdate());
        }

        // --- 2. Physics Tick Method ---
        this.tickTimes = [];
        this.lastTickTime = Date.now();
        this.physicsTPS = 20.0;
        this.bot.on('physicsTick', () => this.onPhysicsTick());

        // --- 3. Game Time Method ---
        this.tpsHistory = [];
        this.lastGameTime = 0n; // Initialize as a bigint primitive
        this.lastRealTime = Date.now();
        this.gameTimeInterval = null;
    }

    start() {
        // This method is called safely after the bot has spawned
        if (this.bot.time && typeof this.bot.time.bigTime !== 'undefined' && this.bot.time.bigTime !== null) {
            // bot.time.bigTime is a BigInt object, we need the primitive for arithmetic.
            // The primitive value is obtained by just assigning it. TypeScript's lib.es2020.d.ts handles this.
            // The issue was likely conflicting or outdated type definitions.
            // Let's treat it as a primitive `bigint` directly.
            this.lastGameTime = BigInt(String(this.bot.time.bigTime));
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
        // timeElapsed is the time since the last server time update packet
        const timeElapsed = (now - this.lastPacketTime) / 1000;
        if (timeElapsed > 0) {
            // A time update packet is sent every second if the server is running at 20 TPS.
            const tps = Math.min(20.0, 1.0 / timeElapsed * 20.0);
            this.packetTpsValues.push(tps);
            if (this.packetTpsValues.length > 20) this.packetTpsValues.shift();
        }
        this.lastPacketTime = now;
    }

    getPacketTPS(): number {
        if (this.packetTpsValues.length === 0) return 20.0;
        const average = this.packetTpsValues.reduce((a, b) => a + b, 0) / this.packetTpsValues.length;
        return Math.round(average * 100) / 100;
    }

    // --- Physics Tick Logic ---
    onPhysicsTick() {
        const now = Date.now();
        const deltaTime = now - this.lastTickTime;
        this.tickTimes.push(deltaTime);
        if (this.tickTimes.length > 100) this.tickTimes.shift();
        
        // Calculate average delta time over the last 100 ticks
        const avgDeltaTime = this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length;
        
        // 1000ms / 50ms/tick = 20 ticks/sec
        if (avgDeltaTime > 0) {
            this.physicsTPS = Math.min(20.0, 1000 / avgDeltaTime);
        }
        this.lastTickTime = now;
    }

    getPhysicsTPS(): number {
        return Math.round(this.physicsTPS * 100) / 100;
    }

    // --- Game Time Logic ---
    calculateGameTimeTPS() {
        if (!this.bot.time || typeof this.bot.time.bigTime === 'undefined' || this.bot.time.bigTime === null) return;

        const currentGameTime = BigInt(String(this.bot.time.bigTime));
        const currentRealTime = Date.now();

        // Ensure we are working with primitive bigints for subtraction
        const gameTimeDiff = currentGameTime - this.lastGameTime;
        const realTimeDiff = currentRealTime - this.lastRealTime;

        if (realTimeDiff > 0) {
            // (game ticks) / (real ms) * (1000 ms / 1 s) = ticks per second
            const tps = (Number(gameTimeDiff) / realTimeDiff) * 1000;
            this.tpsHistory.push(Math.min(20, tps));
            if (this.tpsHistory.length > 60) this.tpsHistory.shift();
        }

        this.lastGameTime = currentGameTime;
        this.lastRealTime = currentRealTime;
    }

    getGameTimeTPS(): number {
        if (this.tpsHistory.length === 0) return 20.0;
        const average = this.tpsHistory.reduce((a, b) => a + b, 0) / this.tpsHistory.length;
        return Math.round(average * 100) / 100;
    }
    
    // --- Cleanup ---
    stop() {
        if (this.gameTimeInterval) {
            clearInterval(this.gameTimeInterval);
            this.gameTimeInterval = null;
        }
        // Clear listeners to prevent memory leaks
        this.bot.removeListener('physicsTick', this.onPhysicsTick);
        if (this.bot && this.bot._client) {
            this.bot._client.removeListener('update_time', this.onTimeUpdate);
        }
    }
}
