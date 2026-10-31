/**
 * skill 库写入/删除（skill 编辑器后端，8/12 收缩定案）。
 *
 * 写的就是 scanSkillFiles 读的 `skills/<目录>/SKILL.md`——编辑器产物=引擎消费物，
 * 同一份文件：保存后下一拍装载（loadStageMaterials 每拍现读）即进 L1 索引/skill_read
 * 货架，常驻档全文随 system。不存在第二套"面板专用"存储。
 */

import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { scanSkillFiles, stageSkillRoot } from "./materials.ts";

/** frontmatter 值与目录名都压成单行（解析器按行读，换行会截断语义） */
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 目录名卫生：拒绝路径穿越/隐藏目录/Windows 非法字符。名称可中文。 */
export function sanitizeSkillDir(name: string): string | null {
	const d = oneLine(name);
	if (!d || d.includes("/") || d.includes("\\") || d.includes("..") || d.startsWith(".")) return null;
	if (/[<>:"|?*]/.test(d)) return null;
	return d;
}

interface StageSkillInput {
	/** 已有 skill 的存储目录（编辑）；缺省=新建，目录取名称 */
	dir?: string;
	name: string;
	description: string;
	body: string;
	/** 对模型隐身开关；不给＝沿用文件里现有的值（改正文的调用方不必知道有这个键） */
	disabled?: boolean;
	scope?: "global" | "card";
}

/** 保存（新建或覆盖已有目录）。返回实际存储目录名。 */
export function saveStageSkill(cwd: string, input: StageSkillInput): { dir: string } {
	const name = oneLine(input.name);
	const description = oneLine(input.description);
	if (!name) throw new Error("skill 名称为空");
	if (!description) throw new Error("简要说明为空（模型靠它决定何时读这个 skill）");
	if (!input.body.trim()) throw new Error("正文为空");
	const dir = sanitizeSkillDir(input.dir ?? name);
	if (!dir) throw new Error("名称/目录含路径字符，无法作为存储目录");
	const existing = input.dir ? scanSkillFiles(cwd, !!input.scope).filter((s) => s.dir === dir && (!input.scope || s.scope === input.scope)) : [];
	if (existing.length > 1) throw new Error("同目录名存在于多份技能，请指定 scope。");
	const root = existing[0]?.root ?? stageSkillRoot(cwd, input.scope);
	const folder = join(root, dir);
	if (existsSync(folder)) {
		const rel = relative(realpathSync(root), realpathSync(folder));
		if (isAbsolute(rel) || rel.startsWith("..")) throw new Error("技能目录不能指向包外。");
	}
	const file = join(folder, "SKILL.md");
	if (!input.dir) {
		// 新建流：不吞占已有目录（同名 skill 或非 skill 目录都拒绝，改判去编辑流）
		if (existsSync(file)) throw new Error(`已有同名 skill「${dir}」，请换名或编辑原条目`);
		if (existsSync(folder)) throw new Error(`目录 skills/${dir} 已被占用（不是 skill）`);
	}
	// 整文件重写，故未点名 disabled 时先把现值读回来——否则 agent 改一次正文就把用户关掉的开关打开了。
	// 读回走 scanSkillFiles（frontmatter 只有那一个解析器），不另写一份。
	const disabled = input.disabled ?? existing[0]?.disableModelInvocation ?? false;
	mkdirSync(folder, { recursive: true });
	const text = [
		"---",
		`name: ${name}`,
		`description: ${description}`,
		...(disabled ? ["disable-model-invocation: true"] : []),
		"---",
		"",
		input.body.trim(),
		"",
	].join("\n");
	writeFileSync(file, text, "utf8");
	return { dir };
}

/** 删除整个 skill 目录（含 references/ 等附件）。只认有 SKILL.md 的目录。 */
export function deleteStageSkill(cwd: string, dirName: string, scope?: "global" | "card"): void {
	const dir = sanitizeSkillDir(dirName);
	if (!dir) throw new Error("非法目录名");
	const existing = scanSkillFiles(cwd, !!scope).filter((s) => s.dir === dir && (!scope || s.scope === scope));
	if (existing.length !== 1) throw new Error("skill 不存在或目录名有歧义。");
	const root = existing[0].root!;
	const folder = join(root, dir);
	const rel = relative(realpathSync(root), realpathSync(folder));
	if (isAbsolute(rel) || rel.startsWith("..")) throw new Error("技能目录不能指向包外。");
	if (!existsSync(join(folder, "SKILL.md"))) throw new Error(`skill「${dir}」不存在`);
	rmSync(folder, { recursive: true, force: true });
}
