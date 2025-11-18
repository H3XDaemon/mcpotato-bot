const mcData = require('minecraft-data');
const PrismarineChat = require('prismarine-chat');
const { logger } = require('./logger.js');

function createParser(version) {
    const registry = mcData(version);
    if (!registry) {
        logger.error(`[MessageParser] Unsupported Minecraft version: ${version}. Color parsing may not work correctly.`);
        return (str) => str; // Return a no-op parser
    }
    const ChatMessage = PrismarineChat(registry);

    return function parse(messageString) {
        if (typeof messageString !== 'string' || messageString.trim() === '') {
            return messageString;
        }
        
        logger.debug(`[MessageParser] Parsing: "${messageString}"`);

        try {
            const result = ChatMessage.MessageBuilder.fromString(messageString, { colorSeparator: '§' });
            if (result === null) {
                logger.debug('[MessageParser] fromString returned null.');
                return messageString;
            }
            const chatMessage = new ChatMessage(result.toJSON());
            const ansiString = chatMessage.toAnsi();
            logger.debug(`[MessageParser] Result: "${ansiString}"`);
            return ansiString;
        } catch (e) {
            logger.error(`[MessageParser] Failed to parse message: "${messageString}"`, e);
            return messageString; // Return original string on failure
        }
    }
}

module.exports = { createParser };
