import { fuzzyMatch } from "@liyuan/tui";
function normalizeWhitespaceLower(text) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}
function getSessionSearchText(session) {
    return `${session.id} ${session.name ?? ""} ${session.allMessagesText} ${session.cwd}`;
}
export function hasSessionName(session) {
    return Boolean(session.name?.trim());
}
function matchesNameFilter(session, filter) {
    if (filter === "all")
        return true;
    return hasSessionName(session);
}
export function parseSearchQuery(query) {
    const trimmed = query.trim();
    if (!trimmed) {
        return { mode: "tokens", tokens: [], regex: null };
    }
    // Regex mode: re:<pattern>
    if (trimmed.startsWith("re:")) {
        const pattern = trimmed.slice(3).trim();
        if (!pattern) {
            return { mode: "regex", tokens: [], regex: null, error: "Empty regex" };
        }
        try {
            return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { mode: "regex", tokens: [], regex: null, error: msg };
        }
    }
    // Token mode with quote support.
    // Example: foo "node cve" bar
    const tokens = [];
    let buf = "";
    let inQuote = false;
    let hadUnclosedQuote = false;
    const flush = (kind) => {
        const v = buf.trim();
        buf = "";
        if (!v)
            return;
        tokens.push({ kind, value: v });
    };
    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === '"') {
            if (inQuote) {
                flush("phrase");
                inQuote = false;
            }
            else {
                flush("fuzzy");
                inQuote = true;
            }
            continue;
        }
        if (!inQuote && /\s/.test(ch)) {
            flush("fuzzy");
            continue;
        }
        buf += ch;
    }
    if (inQuote) {
        hadUnclosedQuote = true;
    }
    // If quotes were unbalanced, fall back to plain whitespace tokenization.
    if (hadUnclosedQuote) {
        return {
            mode: "tokens",
            tokens: trimmed
                .split(/\s+/)
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
                .map((t) => ({ kind: "fuzzy", value: t })),
            regex: null,
        };
    }
    flush(inQuote ? "phrase" : "fuzzy");
    return { mode: "tokens", tokens, regex: null };
}
export function matchSession(session, parsed) {
    const text = getSessionSearchText(session);
    if (parsed.mode === "regex") {
        if (!parsed.regex) {
            return { matches: false, score: 0 };
        }
        const idx = text.search(parsed.regex);
        if (idx < 0)
            return { matches: false, score: 0 };
        return { matches: true, score: idx * 0.1 };
    }
    if (parsed.tokens.length === 0) {
        return { matches: true, score: 0 };
    }
    let totalScore = 0;
    let normalizedText = null;
    for (const token of parsed.tokens) {
        if (token.kind === "phrase") {
            if (normalizedText === null) {
                normalizedText = normalizeWhitespaceLower(text);
            }
            const phrase = normalizeWhitespaceLower(token.value);
            if (!phrase)
                continue;
            const idx = normalizedText.indexOf(phrase);
            if (idx < 0)
                return { matches: false, score: 0 };
            totalScore += idx * 0.1;
            continue;
        }
        const m = fuzzyMatch(token.value, text);
        if (!m.matches)
            return { matches: false, score: 0 };
        totalScore += m.score;
    }
    return { matches: true, score: totalScore };
}
export function filterAndSortSessions(sessions, query, sortMode, nameFilter = "all") {
    const nameFiltered = nameFilter === "all" ? sessions : sessions.filter((session) => matchesNameFilter(session, nameFilter));
    const trimmed = query.trim();
    if (!trimmed)
        return nameFiltered;
    const parsed = parseSearchQuery(query);
    if (parsed.error)
        return [];
    // Recent mode: filter only, keep incoming order.
    if (sortMode === "recent") {
        const filtered = [];
        for (const s of nameFiltered) {
            const res = matchSession(s, parsed);
            if (res.matches)
                filtered.push(s);
        }
        return filtered;
    }
    // Relevance mode: sort by score, tie-break by modified desc.
    const scored = [];
    for (const s of nameFiltered) {
        const res = matchSession(s, parsed);
        if (!res.matches)
            continue;
        scored.push({ session: s, score: res.score });
    }
    scored.sort((a, b) => {
        if (a.score !== b.score)
            return a.score - b.score;
        return b.session.modified.getTime() - a.session.modified.getTime();
    });
    return scored.map((r) => r.session);
}
//# sourceMappingURL=session-selector-search.js.map