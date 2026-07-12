function decodeCodePoint(codePoint) {
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return undefined;
    }
    return String.fromCodePoint(codePoint);
}
export function decodeHtmlEntity(entity) {
    switch (entity) {
        case "amp":
            return "&";
        case "lt":
            return "<";
        case "gt":
            return ">";
        case "quot":
            return '"';
        case "apos":
            return "'";
    }
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return decodeCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
        return decodeCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return undefined;
}
export function decodeHtmlEntityAt(html, index) {
    const semicolonIndex = html.indexOf(";", index + 1);
    if (semicolonIndex === -1 || semicolonIndex - index > 16) {
        return undefined;
    }
    const entity = html.slice(index + 1, semicolonIndex);
    const decoded = decodeHtmlEntity(entity);
    if (decoded === undefined) {
        return undefined;
    }
    return { text: decoded, length: semicolonIndex - index + 1 };
}
//# sourceMappingURL=html.js.map