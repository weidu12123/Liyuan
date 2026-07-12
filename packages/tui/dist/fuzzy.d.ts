/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */
export interface FuzzyMatch {
    matches: boolean;
    score: number;
}
export declare function fuzzyMatch(query: string, text: string): FuzzyMatch;
/**
 * Filter and sort items by fuzzy match quality (best matches first).
 * Supports whitespace- and slash-separated tokens: all tokens must match.
 */
export declare function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[];
//# sourceMappingURL=fuzzy.d.ts.map