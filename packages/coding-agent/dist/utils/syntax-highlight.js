import hljs from "highlight.js/lib/index.js";
import { decodeHtmlEntityAt } from "./html.js";
const SPAN_CLOSE = "</span>";
const HIGHLIGHT_CLASS_PREFIX = "hljs-";
function getScopeFromSpanTag(tag) {
    const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
    const classValue = match?.[1] ?? match?.[2];
    if (!classValue) {
        return undefined;
    }
    for (const className of classValue.split(/\s+/)) {
        if (className.startsWith(HIGHLIGHT_CLASS_PREFIX)) {
            return className.slice(HIGHLIGHT_CLASS_PREFIX.length);
        }
    }
    return undefined;
}
function getScopeFormatter(scope, theme) {
    const exact = theme[scope];
    if (exact) {
        return exact;
    }
    const dotIndex = scope.indexOf(".");
    if (dotIndex !== -1) {
        const prefixFormatter = theme[scope.slice(0, dotIndex)];
        if (prefixFormatter) {
            return prefixFormatter;
        }
    }
    const dashIndex = scope.indexOf("-");
    if (dashIndex !== -1) {
        const prefixFormatter = theme[scope.slice(0, dashIndex)];
        if (prefixFormatter) {
            return prefixFormatter;
        }
    }
    return undefined;
}
function getActiveFormatter(scopes, theme) {
    for (let i = scopes.length - 1; i >= 0; i--) {
        const scope = scopes[i];
        if (!scope) {
            continue;
        }
        const formatter = getScopeFormatter(scope, theme);
        if (formatter) {
            return formatter;
        }
    }
    return theme.default;
}
function isSpanOpenTagStart(html, index) {
    if (!html.startsWith("<span", index)) {
        return false;
    }
    const nextChar = html[index + "<span".length];
    return nextChar === ">" || nextChar === " " || nextChar === "\t" || nextChar === "\n" || nextChar === "\r";
}
export function renderHighlightedHtml(html, theme = {}) {
    let output = "";
    let textBuffer = "";
    const scopes = [];
    const flushText = () => {
        if (!textBuffer) {
            return;
        }
        const formatter = getActiveFormatter(scopes, theme);
        output += formatter ? formatter(textBuffer) : textBuffer;
        textBuffer = "";
    };
    let index = 0;
    while (index < html.length) {
        if (isSpanOpenTagStart(html, index)) {
            const tagEndIndex = html.indexOf(">", index + 5);
            if (tagEndIndex !== -1) {
                flushText();
                const tag = html.slice(index, tagEndIndex + 1);
                const scope = getScopeFromSpanTag(tag);
                scopes.push(scope);
                index = tagEndIndex + 1;
                continue;
            }
        }
        if (html.startsWith(SPAN_CLOSE, index)) {
            flushText();
            if (scopes.length > 0) {
                scopes.pop();
            }
            index += SPAN_CLOSE.length;
            continue;
        }
        if (html[index] === "&") {
            const decoded = decodeHtmlEntityAt(html, index);
            if (decoded) {
                textBuffer += decoded.text;
                index += decoded.length;
                continue;
            }
        }
        textBuffer += html[index];
        index++;
    }
    flushText();
    return output;
}
export function highlight(code, options = {}) {
    const html = options.language
        ? hljs.highlight(code, {
            language: options.language,
            ignoreIllegals: options.ignoreIllegals,
        }).value
        : hljs.highlightAuto(code, options.languageSubset).value;
    return renderHighlightedHtml(html, options.theme);
}
export function supportsLanguage(name) {
    return hljs.getLanguage(name) !== undefined;
}
//# sourceMappingURL=syntax-highlight.js.map