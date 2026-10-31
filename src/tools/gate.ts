/**
 * 写入门禁（PLAN-RP-TOOLING D-T4：写侧工具走门禁，**不新造权限体系**）。
 *
 * 语义搬自 `.liyuan/extensions/roleplay.ts`（HEAD 第 1851-1857 行）——那套是用户认可的
 * 既有行为，不是新造的：**只有用户本轮明确要求记录，才允许把内容写进用户的设定集**。
 *
 * 为什么搬进 `src/`：原实现是扩展里的闭包，而扩展工具面对台上不可达（TOOLING §7.2）；
 * 台上要开放 `lorebook_write` 就必须有门禁，而 `src/` 此前一处门禁也没有。
 * 搬成**纯函数**（输入用户原文 + 工具名 → 放行/拦截）后两侧共用，且可离线单测。
 *
 * ⚠ 原扩展里的三个定义已被未提交的清场删除、调用点留存 → `creationMode:"ask"` 时必抛
 * `ReferenceError`（记为 M-D6 R3）。修复那处时**从本模块取**，不要再手抄一份。
 */

/**
 * 受门禁约束的工具：写用户**持久设定数据**的那些。
 *
 * 判据是「写的是不是用户的资料」——
 *   - `world_state_update` 不在列：它是每拍剧情记账（有场记兜底），拦了剧情就漂移；
 *   - draft 五件不在列：写的是本拍草稿，不落用户数据。
 *
 * M-D3 追加 `memory_add`/`memory_delete`：向量库虽只活在本对话（不跨会话），
 * 但**回音室风险比世界书更隐蔽**——模型自作主张灌进去的内容，下一拍 `memory_search`
 * 又当「既定事实」捞回来，而条目要翻管理面板才看得见。
 *
 * ⚠ 与铁律三的关系：本表列的是**梨园自己发行的工具名**（自家协议），
 * 不是「别人发明的名字」——铁律三禁的是 FOLD_NAME_RE / cardStatusBarFormats 那类
 * 追着卡作者/预设作者措辞跑的识别器。此表正是铁律三的替代所要的那份
 * 「看得见、改得动的数据」：加一件受管工具就在这里加一行，不写进任何分支里。
 */
export const GATED_TOOLS = [
	"lorebook_write",
	"memory_add",
	"memory_delete",
	"memory_update",
] as const;

/**
 * 用户主动要求记录的信号。**宽松匹配是刻意的**（原注释：宁可放行用户明确要求的写入，
 * 也不拦错）——门禁的成本不对称：错拦会让用户明确的指令失效且模型无从申辩，
 * 错放只是多一条可删的设定条目。
 */
const WRITE_REQUEST_RE =
	/(写入|写进|写一下|记下|记入|记录|记住|牢记|登记|存进|存到|保存|收藏|归档|收进|收录|固化|入典|沉淀|备注|补充设定|世界书|设定集|知识库|图鉴|物志|向量|记忆库|record|save|store|remember|memorize|lorebook|codex)/i;

/**
 * 删除请求的信号（M-D3）。**不能复用 `WRITE_REQUEST_RE`**：用户说「把那条忘掉」
 * 不含任何写入词，会被错拦；反过来把删除词并进写入词集，则「删掉那条设定」
 * 会去放行 `lorebook_write`——两个信号集必须分开，按工具名选。
 */
export const DELETE_REQUEST_RE =
	/(忘掉|忘记|忘了|删掉|删除|删了|去掉|清除|清掉|移除|撤掉|不要了|记错|搞错|弄错|不对|作废|forget|delete|remove|drop)/i;

/**
 * 工具名 → 该工具认哪些用户信号。删除类一律认删除信号（不按具体族点名）；
 * **改类两套都认**——「改」的诉求既可能说成写入侧（「把那条改成…」），也可能说成
 * 否定侧（「那条记错了/不对」），取并集是宽松方向，符合本模块的成本不对称。
 *
 * ⚠ 已记漏网，**不修**：两套里都没有「改／修改／更正」本身。补它就是往
 * WRITE_REQUEST_RE 里添行（铁律三禁的正是这种「出了问题再加一条」）。
 * 漏网的后果是模型被拦一次并被告知别追问，用户改口即可——比堆一层启发式便宜。
 */
function signalMatches(toolName: string, text: string): boolean {
	if (/_delete$/.test(toolName)) return DELETE_REQUEST_RE.test(text);
	if (/_update$/.test(toolName)) return WRITE_REQUEST_RE.test(text) || DELETE_REQUEST_RE.test(text);
	return WRITE_REQUEST_RE.test(text);
}

/** 门禁判定结果：allow=放行；block 带 reason（原样回给模型，别让它转头去问用户） */
type GateVerdict = { allow: true } | { allow: false; reason: string };

/** 被拦时回给模型的话术（搬自原实现：明确禁止「转头问用户要不要写」） */
const GATE_BLOCK_REASON =
	"写入设定集需用户明确要求：本轮用户并未要求记录，本次写入已拒绝。" +
	"不要写、也不要询问「是否写入」；若用户后续明确要求再执行。";

/**
 * 删除被拦时的话术（M-D3）。与写入同一条纪律（不要转头问用户），
 * 但**成本方向相反**：错删不可逆且用户不易察觉，故话术要指向「继续演」而不是「等确认」。
 */
const GATE_DELETE_BLOCK_REASON =
	"删除记忆条目需用户明确要求：本轮用户并未要求删除，本次删除已拒绝。" +
	"不要删、也不要询问「是否删除」；记忆有误就在正文里绕开它，若用户后续明确要求再执行。";

export interface GateInput {
	toolName: string;
	/** 本拍用户原文；读不到时传空串（宁拦勿写，见下） */
	lastUserText: string;
	/** 决策门禁档位；仅 "ask" 档启用门禁（silent = 旧行为，不拦） */
	creationMode?: "ask" | "silent";
}

/**
 * 判定一次写入是否放行。
 *
 * 注意 `creationMode` 的语义沿用原实现：**silent 档不拦**（等同旧行为）。
 * 会话读不到用户原文时 lastUserText 传空串 → 不匹配 → 拦下（宁拦勿写）。
 */
export function checkWriteGate(input: GateInput): GateVerdict {
	if (input.creationMode !== "ask") return { allow: true };
	if (!(GATED_TOOLS as readonly string[]).includes(input.toolName)) return { allow: true };
	if (signalMatches(input.toolName, input.lastUserText)) return { allow: true };
	return {
		allow: false,
		reason: /_delete$/.test(input.toolName) ? GATE_DELETE_BLOCK_REASON : GATE_BLOCK_REASON,
	};
}
