import { Container, SelectList } from "@liyuan/tui";
import { getSelectListTheme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
const THINKING_SELECT_LIST_LAYOUT = {
    minPrimaryColumnWidth: 12,
    maxPrimaryColumnWidth: 32,
};
const LEVEL_DESCRIPTIONS = {
    off: "No reasoning",
    minimal: "Very brief reasoning (~1k tokens)",
    low: "Light reasoning (~2k tokens)",
    medium: "Moderate reasoning (~8k tokens)",
    high: "Deep reasoning (~16k tokens)",
    xhigh: "Maximum reasoning (~32k tokens)",
};
/**
 * Component that renders a thinking level selector with borders
 */
export class ThinkingSelectorComponent extends Container {
    selectList;
    constructor(currentLevel, availableLevels, onSelect, onCancel) {
        super();
        const thinkingLevels = availableLevels.map((level) => ({
            value: level,
            label: level,
            description: LEVEL_DESCRIPTIONS[level],
        }));
        // Add top border
        this.addChild(new DynamicBorder());
        // Create selector
        this.selectList = new SelectList(thinkingLevels, thinkingLevels.length, getSelectListTheme(), THINKING_SELECT_LIST_LAYOUT);
        // Preselect current level
        const currentIndex = thinkingLevels.findIndex((item) => item.value === currentLevel);
        if (currentIndex !== -1) {
            this.selectList.setSelectedIndex(currentIndex);
        }
        this.selectList.onSelect = (item) => {
            onSelect(item.value);
        };
        this.selectList.onCancel = () => {
            onCancel();
        };
        this.addChild(this.selectList);
        // Add bottom border
        this.addChild(new DynamicBorder());
    }
    getSelectList() {
        return this.selectList;
    }
}
//# sourceMappingURL=thinking-selector.js.map