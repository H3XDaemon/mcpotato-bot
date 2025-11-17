
import { BotJava } from './bot.js';
import { BotTask } from './task.js';

interface ActiveTask {
    task: BotTask;
    intervalId: NodeJS.Timeout;
}

export class TaskManager {
    private bot: BotJava;
    private tasks: Map<string, BotTask>;
    private activeTask: ActiveTask | null;

    constructor(bot: BotJava) {
        this.bot = bot;
        this.tasks = new Map();
        this.activeTask = null;
    }

    public register(task: BotTask): void {
        if (this.tasks.has(task.name)) {
            this.bot.logger.warn(`[TaskManager] Task with name '${task.name}' is already registered.`);
            return;
        }
        this.tasks.set(task.name, task);
        this.bot.logger.info(`[TaskManager] Registered task: ${task.name}`);
    }

    public async start(taskName: string, interval: number = 10000): Promise<void> {
        if (this.activeTask) {
            this.bot.logger.error(`[TaskManager] Cannot start task '${taskName}'. Another task '${this.activeTask.task.name}' is already running.`);
            return;
        }

        const task = this.tasks.get(taskName);
        if (!task) {
            this.bot.logger.error(`[TaskManager] Task '${taskName}' not found.`);
            return;
        }

        if (task.setup) {
            await task.setup(this.bot);
        }

        const intervalId = setInterval(() => {
            task.execute(this.bot).catch(err => {
                this.bot.logger.error(`[TaskManager] Error during execution of task '${task.name}': ${err.message}`);
            });
        }, interval);

        this.activeTask = { task, intervalId };
        this.bot.logger.info(`[TaskManager] Started task '${task.name}' with an interval of ${interval / 1000} seconds.`);
    }

    public async stop(): Promise<void> {
        if (!this.activeTask) {
            this.bot.logger.warn('[TaskManager] No active task to stop.');
            return;
        }

        const taskToStop = this.activeTask;
        this.activeTask = null;

        clearInterval(taskToStop.intervalId);

        if (taskToStop.task.teardown) {
            await taskToStop.task.teardown(this.bot);
        }

        this.bot.logger.info(`[TaskManager] Stopped task '${taskToStop.task.name}'.`);
    }
    
    public getActiveTaskName(): string | null {
        return this.activeTask ? this.activeTask.task.name : null;
    }

    public getAvailableTasks(): string[] {
        return Array.from(this.tasks.keys());
    }
}
