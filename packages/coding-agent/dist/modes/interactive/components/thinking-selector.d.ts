import type { ThinkingLevel } from "@liyuan/agent-core";
import { Container, SelectList } from "@liyuan/tui";
/**
 * Component that renders a thinking level selector with borders
 */
export declare class ThinkingSelectorComponent extends Container {
    private selectList;
    constructor(currentLevel: ThinkingLevel, availableLevels: ThinkingLevel[], onSelect: (level: ThinkingLevel) => void, onCancel: () => void);
    getSelectList(): SelectList;
}
//# sourceMappingURL=thinking-selector.d.ts.map