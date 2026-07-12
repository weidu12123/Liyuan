import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeHtmlDocument, splitHtmlParts } from "../web/src/htmlEmbed.ts";

test("splitHtmlParts: plain text", () => {
	const p = splitHtmlParts("hello\n\nworld");
	assert.equal(p.length, 1);
	assert.equal(p[0].kind, "text");
});

test("splitHtmlParts: fenced html", () => {
	const p = splitHtmlParts('前\n```html\n<div class="phone">hi</div>\n```\n后');
	assert.equal(p.length, 3);
	assert.equal(p[0].kind, "text");
	assert.equal(p[1].kind, "html");
	if (p[1].kind === "html") {
		assert.ok(p[1].html.includes("phone"));
		assert.equal(p[1].scripts, false);
	}
	assert.equal(p[2].kind, "text");
});

test("splitHtmlParts: scripts fence", () => {
	const p = splitHtmlParts("```html scripts\n<script>1</script>\n```");
	assert.equal(p.length, 1);
	assert.equal(p[0].kind, "html");
	if (p[0].kind === "html") assert.equal(p[0].scripts, true);
});

test("looksLikeHtmlDocument", () => {
	assert.equal(looksLikeHtmlDocument("<!DOCTYPE html><html></html>"), true);
	assert.equal(looksLikeHtmlDocument("not html"), false);
});
