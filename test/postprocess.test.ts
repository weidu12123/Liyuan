import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanAssistantText } from "../src/postprocess.ts";

test("结构块剥离：分析/状态整块删除，plot 拆包保留正文", () => {
	const raw = `<descriptive_analysis>
1. 意图分析…
2. 好感8（陌路之人阶段）
</descriptive_analysis>

<normal_status>
\`\`\`yaml
『时间』: 次日清晨
\`\`\`
</normal_status>

<plot>

*她咬了一口葱油饼，动作微微一顿。*

「短剑在你自己的行囊里。」

</plot>`;
	const out = cleanAssistantText(raw);
	assert.ok(!out.includes("descriptive_analysis"));
	assert.ok(!out.includes("意图分析"));
	assert.ok(!out.includes("normal_status"));
	assert.ok(!out.includes("『时间』"));
	assert.ok(!out.includes("<plot>"));
	assert.ok(out.startsWith("*她咬了一口葱油饼"), "plot 内容应保留且顶格");
	assert.ok(out.includes("「短剑在你自己的行囊里。」"));
});

test("悬挂开标签剥到末尾；无结构块的文本只做空白收敛", () => {
	assert.equal(cleanAssistantText("*正文。*\n<thinking>被截断的思考"), "*正文。*");
	assert.equal(cleanAssistantText("行尾空白   \n\n\n\n下一段。"), "行尾空白\n\n下一段。");
});
