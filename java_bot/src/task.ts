
import { BotJava } from './bot.js';

/**
 * Defines the structure for a long-running, repeatable bot task.
 */
export interface BotTask {
    /**
     * The unique name of the task.
     */
    name: string;

    /**
     * The core logic of the task. This function is executed repeatedly.
     * @param bot The BotJava instance performing the task.
     */
    execute: (bot: BotJava) => Promise<void>;

    /**
     * An optional setup function called once before the task starts.
     * @param bot The BotJava instance.
     */
    setup?: (bot: BotJava) => Promise<void>;

    /**
     * An optional teardown function called once after the task is stopped.
     * @param bot The BotJava instance.
     */
    teardown?: (bot: BotJava) => Promise<void>;
}
