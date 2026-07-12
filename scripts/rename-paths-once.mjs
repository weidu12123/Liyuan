// one-shot string rewrite for rest.ts / roleplay path renames
import { readFileSync, writeFileSync } from "node:fs";

const patch = (file, fn) => {
	let s = readFileSync(file, "utf8");
	const n = fn(s);
	writeFileSync(file, n);
	console.log("patched", file);
};

patch("server/rest.ts", (s) => {
	if (!s.includes("resolveConfigPath")) {
		s = s.replace(
			'import { RP_COMMANDS } from "../src/commands.ts";',
			'import { RP_COMMANDS } from "../src/commands.ts";\nimport { resolveConfigPath } from "../src/paths.ts";',
		);
	}
	s = s.replace(
		'const configPath = (cwd: string) => join(cwd, "rp.config.json");',
		"const configPath = (cwd: string) => resolveConfigPath(cwd);",
	);
	s = s.replaceAll(".rp-cache", ".liyuan-cache");
	s = s.replaceAll(".rp-uploads", ".liyuan-uploads");
	s = s.replaceAll(".rp-media", ".liyuan-media");
	s = s.replaceAll(".rp-skills", ".liyuan-skills");
	s = s.replaceAll("rp-preset.json", "liyuan-preset.json");
	s = s.replaceAll("rp.config.json", "liyuan.config.json");
	return s;
});

patch(".pi/extensions/roleplay.ts", (s) => {
	if (!s.includes('from "../../src/paths.ts"')) {
		s = s.replace(
			'import { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig, type WorldState } from "../../src/types.ts";',
			'import { dir, resolveConfigPath, DIRS } from "../../src/paths.ts";\nimport { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig, type WorldState } from "../../src/types.ts";',
		);
	}
	s = s.replaceAll('join(ctx.cwd, "rp.config.json")', "resolveConfigPath(ctx.cwd)");
	s = s.replaceAll('join(ctx.cwd, ".rp-state"', 'join(dir(ctx.cwd, "state")');
	// fix broken if above doubled join
	s = s.replaceAll(
		'stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`)',
		'stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`)',
	);
	// original form
	s = s.replace(
		/stateFile = join\(ctx\.cwd, "\.rp-state", `\$\{ctx\.sessionManager\.getSessionId\(\)\}\.json`\);/g,
		'stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`);',
	);
	s = s.replace(
		/panelsFile = join\(ctx\.cwd, "\.rp-artifacts", `\$\{ctx\.sessionManager\.getSessionId\(\)\}\.json`\);/g,
		'panelsFile = join(dir(ctx.cwd, "artifacts"), `${ctx.sessionManager.getSessionId()}.json`);',
	);
	s = s.replaceAll('join(ctx.cwd, ".rp-cache"', 'join(dir(ctx.cwd, "cache")');
	s = s.replaceAll('join(appCwd, ".rp-media")', 'dir(appCwd, "media")');
	s = s.replaceAll(".rp-skills/", `${"${DIRS.skills}"}/`);
	// fix botched template - do cleanly
	s = s.replaceAll(".rp-skills/", ".liyuan-skills/");
	s = s.replaceAll(".rp-lore/", ".liyuan-lore/");
	s = s.replaceAll(".rp-codex/", ".liyuan-codex/");
	s = s.replaceAll(".rp-state", ".liyuan-state");
	s = s.replaceAll(".rp-artifacts", ".liyuan-artifacts");
	s = s.replaceAll(".rp-cache", ".liyuan-cache");
	s = s.replaceAll(".rp-media", ".liyuan-media");
	s = s.replaceAll(".rp-audio", ".liyuan-audio");
	s = s.replaceAll(".rp-uploads", ".liyuan-uploads");
	return s;
});

patch("server/main.ts", (s) => {
	s = s.replace(
		'const artifactsDir = join(cwd, ".rp-artifacts");',
		'const artifactsDir = dir(cwd, "artifacts");',
	);
	s = s.replaceAll('join(cwd, ".rp-media")', 'dir(cwd, "media")');
	s = s.replaceAll('join(cwd, ".rp-audio")', 'dir(cwd, "audio")');
	s = s.replaceAll('join(cwd, ".rp-uploads")', 'dir(cwd, "uploads")');
	return s;
});
