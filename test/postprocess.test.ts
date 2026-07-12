import assert from "node:assert/strict";
import { test } from "node:test";

import {
	cleanAssistantText,
	displayAssistantText,
	extractScaffoldThinking,
} from "../src/postprocess.ts";

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

test("displayAssistantText：假思维链/草稿隐去，状态栏保留，content 拆包", () => {
	const raw = `<draft_notes>
本轮分析：用户要润墨
</draft_notes>

### 正文

<content>
<!-- Prism: 第一人称视角 -->
文舒婉听话了。

<!-- Prism: 感官 -->
她拿起墨条。
</content>

<StatusBlock>
地点:御书房
姓名:文舒婉
</StatusBlock>`;
	const out = displayAssistantText(raw);
	assert.ok(!out.includes("draft_notes"), "草稿块应隐去");
	assert.ok(!out.includes("本轮分析"), "草稿内容应隐去");
	assert.ok(!out.includes("<content>"), "content 标签应拆掉");
	assert.ok(!out.includes("</content>"));
	assert.ok(!out.includes("Prism"), "HTML 注释应隐去");
	assert.ok(!out.includes("### 正文"), "分隔标题应隐去");
	assert.ok(out.includes("<StatusBlock>"), "状态栏保留给前端面板");
	assert.ok(out.includes("地点:御书房"));
	assert.ok(out.includes("文舒婉听话了"));
	assert.ok(out.includes("她拿起墨条"));
});

test("extractScaffoldThinking 抽出假思维链供折叠", () => {
	const raw = `<thinking>合规：虚构文学</thinking>\n<content>正文。</content>`;
	const th = extractScaffoldThinking(raw);
	assert.ok(th.includes("合规"));
	assert.ok(!th.includes("正文"));
});
