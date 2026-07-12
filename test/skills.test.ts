import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatSkillIndex, listSkills, saveSkill, skillSlug } from "../src/skills.ts";

test("skillSlug replaces reserved chars and spaces", () => {
	assert.equal(skillSlug("comfyui draw: v2"), "comfyui-draw-v2");
	assert.equal(skillSlug("  "), "skill");
});

test("saveSkill and listSkills roundtrip", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-sk-"));
	try {
		const first = saveSkill(dir, {
			name: "draw",
			description: "comfy",
			content: "# how\ncurl ...",
		});
		assert.equal(first.file, ".liyuan-skills/draw.md");
		assert.equal(first.updated, false);
		const second = saveSkill(dir, {
			name: "draw",
			description: "comfy v2",
			content: "# updated",
		});
		assert.equal(second.updated, true);
		const list = listSkills(dir);
		assert.equal(list.length, 1);
		assert.equal(list[0].name, "draw");
		assert.equal(list[0].description, "comfy v2");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("formatSkillIndex", () => {
	const text = formatSkillIndex([{ name: "draw", description: "comfy", file: ".liyuan-skills/draw.md" }]);
	assert.match(text, /draw/);
	assert.match(text, /comfy/);
	const hidden = formatSkillIndex([
		{ name: "secret", description: "d", file: ".liyuan-skills/secret.md", disableModelInvocation: true },
	]);
	assert.ok(hidden.includes("空") || hidden === "");
});
