/**
 * 技能库（PLAN-PHASE3 §6.4 技能沉淀）：agent 摸通外部服务后自写的调用笔记。
 *
 * 形态：`.liyuan-skills/*.md`，frontmatter（name/description）+ Markdown 正文
 * （endpoint、认证、请求格式、可用的 curl 示例、注意事项）。
 * 登记表不是用户填的门禁，是 agent 自己写的笔记本；文件可直接分享
 * （Backlog「agent 配置包」的雏形）。全局共享，不按卡分——技能是能力，不是剧情正典。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIRS, dir } from "./paths.ts";

export interface SkillMeta {
	name: string;
	description: string;
	/** 相对 cwd 的文件路径（写进提示词，agent 用 read 工具取全文） */
	file: string;
	/** Agent Skills 标准语义：true 时对模型隐身（不进索引），仅 /skill:name 显式触发 */
	disableModelInvocation?: boolean;
}

export interface SkillInput {
	name: string;
	description: string;
	content: string;
	/** Agent Skills 标准字段：true 时不进 system prompt 索引，仅可经 /skill:name 显式触发 */
	disableModelInvocation?: boolean;
}

export function skillsDir(cwd: string): string {
	return dir(cwd, "skills");
}

/** 技能名 → 文件名（Windows 保留字符与空白替换为连字符） */
export function skillSlug(name: string): string {
	const s = name
		.trim()
		.replace(/[\\/:*?"<>|\s]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return s || "skill";
}

/** 解析技能文件头部 frontmatter；无 frontmatter 时返回空对象 */
export function parseSkillHead(text: string): {
	name?: string;
	description?: string;
	disableModelInvocation?: boolean;
} {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!m) return {};
	const out: { name?: string; description?: string; disableModelInvocation?: boolean } = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^(name|description):\s*(.*)$/.exec(line.trim());
		if (kv) out[kv[1] as "name" | "description"] = kv[2].trim();
		const dmi = /^disable-model-invocation:\s*(.*)$/.exec(line.trim());
		if (dmi) out.disableModelInvocation = dmi[1].trim() === "true";
	}
	return out;
}

/** 列出技能库全部技能（目录不存在或文件损坏时安静降级） */
export function listSkills(cwd: string): SkillMeta[] {
	const dir = skillsDir(cwd);
	if (!existsSync(dir)) return [];
	const out: SkillMeta[] = [];
	for (const f of readdirSync(dir)) {
		if (!f.endsWith(".md")) continue;
		try {
			const head = parseSkillHead(readFileSync(join(dir, f), "utf8"));
			out.push({
				name: head.name || f.replace(/\.md$/, ""),
				description: head.description || "",
				file: `${DIRS.skills}/${f}`,
				...(head.disableModelInvocation ? { disableModelInvocation: true } : {}),
			});
		} catch {
			// 单个文件损坏不影响其余技能
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** 写入/更新技能（同名覆盖=更新）。返回落盘信息。 */
export function saveSkill(cwd: string, input: SkillInput): { file: string; updated: boolean } {
	const dir = skillsDir(cwd);
	mkdirSync(dir, { recursive: true });
	const filename = `${skillSlug(input.name)}.md`;
	const abs = join(dir, filename);
	const updated = existsSync(abs);
	const dmi = input.disableModelInvocation ? "disable-model-invocation: true\n" : "";
	const text = `---\nname: ${input.name.trim()}\ndescription: ${input.description.trim().replace(/\r?\n/g, " ")}\n${dmi}---\n\n${input.content.trim()}\n`;
	writeFileSync(abs, text, "utf8");
	return { file: `${DIRS.skills}/${filename}`, updated };
}

/** 技能索引正文（进 system prompt 的技能清单部分；D8：会话内字节稳定，session_start 时装载）。
 * disable-model-invocation 的技能按标准语义对模型隐身，只能经 /skill:name 显式触发。 */
export function formatSkillIndex(skills: SkillMeta[]): string {
	const visible = skills.filter((s) => !s.disableModelInvocation);
	if (visible.length === 0) return "（技能库目前是空的。）";
	return visible.map((s) => `- ${s.name} — ${s.description || "（无描述）"}（${s.file}）`).join("\n");
}
