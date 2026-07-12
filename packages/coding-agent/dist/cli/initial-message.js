/**
 * Combine stdin content, @file text, and the first CLI message into a single
 * initial prompt for non-interactive mode.
 */
export function buildInitialMessage({ parsed, fileText, fileImages, stdinContent, }) {
    const parts = [];
    if (stdinContent !== undefined) {
        parts.push(stdinContent);
    }
    if (fileText) {
        parts.push(fileText);
    }
    if (parsed.messages.length > 0) {
        parts.push(parsed.messages[0]);
        parsed.messages.shift();
    }
    return {
        initialMessage: parts.length > 0 ? parts.join("") : undefined,
        initialImages: fileImages && fileImages.length > 0 ? fileImages : undefined,
    };
}
//# sourceMappingURL=initial-message.js.map