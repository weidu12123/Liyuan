import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatBytes, formatUploadIndex, listUploads, sanitizeUploadName, saveUpload } from "../src/uploads.ts";

test("sanitizeUploadName strips path, replaces reserved chars, keeps ext", () => {
	assert.equal(sanitizeUploadName("../../etc/passwd"), "passwd");
	assert.equal(sanitizeUploadName("C:\\Users\\foo bar:v2?.png"), "foo-bar-v2.png");
	assert.equal(sanitizeUploadName("???.jpg"), "file.jpg");
	assert.equal(sanitizeUploadName(""), "file");
});

test("saveUpload writes under .liyuan-uploads and never overwrites", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-up-"));
	try {
		const a = saveUpload(dir, "map.png", Buffer.from("aaa"));
		assert.match(a.file, /^\.liyuan-uploads\/\d{8}-\d{6}-map\.png$/);
		assert.equal(a.bytes, 3);
		const b = saveUpload(dir, "map.png", Buffer.from("bbbb"));
		assert.notEqual(a.file, b.file);
		const list = listUploads(dir);
		assert.ok(list.every((u) => u.file.startsWith(".liyuan-uploads/")));
		assert.ok(list.length >= 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("formatUploadIndex empty returns null; truncates with note", () => {
	assert.equal(formatUploadIndex([]), null);
	const u = (name: string) => ({ name, file: `.liyuan-uploads/${name}`, bytes: 1024, mtimeMs: 0 });
	const many = Array.from({ length: 8 }, (_, i) => u(`f${i}.txt`));
	const line = formatUploadIndex(many, 3)!;
	assert.ok(line.includes("f0.txt"));
	assert.ok(line.includes("另有"));
});

test("formatBytes", () => {
	assert.equal(formatBytes(100), "100B");
	assert.equal(formatBytes(2048), "2KB");
});
