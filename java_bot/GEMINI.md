# Project Overview

This project is a Node.js-based Minecraft bot that uses the `mineflayer` library to connect to a Minecraft server. The bot is designed to be run in a Docker container and can be controlled via a command-line interface.

The main functionality of the bot appears to be a "work" mode, where it automatically maintains an "Omen" effect in the game. It also includes features for monitoring server TPS (Ticks Per Second) and interacting with in-game menus.

The project is structured with separate files for stable and test environments (`java_bot_stable.js` and `java_bot_test.js`), and it uses JSON files in the `config/` directory for account and server configurations.

## Building and Running

### Running with Node.js

To run the bot directly with Node.js, you can use the following commands:

*   **Stable:** `npm start`
*   **Development/Test:** `npm run dev`

Before running, you will need to create the configuration files in the `config/` directory:

*   `config/accounts_java_stable.json`
*   `config/accounts_java_test.json`

You can likely copy the structure from the example files if they exist.

### Building and Running with Docker

The project includes a `Dockerfile` for building a container image.

1.  **Build the image:**
    ```bash
    docker build -t minecraft-bot .
    ```

2.  **Run the container:**
    ```bash
    docker run -d --name my-bot minecraft-bot
    ```

## Development Conventions

*   **Configuration:** The bot is configured using JSON files in the `config/` directory. There are separate files for stable and test environments.
*   **Logging:** The bot uses a custom logger with different log levels (DEBUG, INFO, WARN, ERROR, CHAT).
*   **Command-Line Interface:** The bot provides an interactive command-line interface for controlling the bot's actions, such as connecting, disconnecting, and running commands.
*   **Dependencies:** The project uses `npm` for package management. Key dependencies include `mineflayer` for the bot's core functionality and `mineflayer-tps` for monitoring server performance.
*   **Code Structure:** The main logic is contained in `java_bot_stable.js` and `java_bot_test.js`. The code is organized into classes and modules for different functionalities, such as the bot itself, the TPS monitor, and the console interface.
