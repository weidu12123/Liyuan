"""Scan files that would be git-committed / release-packed for secrets."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# High-risk patterns (real keys, not placeholders)
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
	("openai_sk", re.compile(r"\bsk-[a-zA-Z0-9]{20,}\b")),
	("openai_proj", re.compile(r"\bsk-proj-[a-zA-Z0-9_-]{20,}\b")),
	("github_pat", re.compile(r"\bghp_[a-zA-Z0-9]{20,}\b")),
	("github_fine", re.compile(r"\bgithub_pat_[a-zA-Z0-9_]{20,}\b")),
	("aws_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
	("private_key", re.compile(r"-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----")),
	("bearer", re.compile(r"\bBearer [A-Za-z0-9._\-]{24,}\b")),
]

# Placeholder-ish allowed substrings near matches
ALLOW = re.compile(
	r"YOUR_|your_|example|placeholder|<.*>|\$\{|process\.env|API_KEY_HERE|xxxx|TODO|changeme",
	re.I,
)


def git_files() -> list[Path]:
	out = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
	return [ROOT / p.decode() for p in out.split(b"\0") if p]


def main() -> int:
	hits: list[str] = []
	for path in git_files():
		if not path.is_file():
			continue
		if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ico"}:
			continue
		if path.stat().st_size > 2_000_000:
			continue
		try:
			text = path.read_text(encoding="utf-8", errors="ignore")
		except OSError:
			continue
		rel = path.relative_to(ROOT).as_posix()
		for name, pat in PATTERNS:
			for m in pat.finditer(text):
				span = text[max(0, m.start() - 40) : m.end() + 40]
				if ALLOW.search(span) or ALLOW.search(m.group()):
					continue
				# example json files intentionally show YOUR_API_KEY_HERE — already allowed
				hits.append(f"{rel}:{m.start()} [{name}] {m.group()[:48]}")

	# Also warn if personal config not ignored
	for risky in [
		"liyuan.config.json",
		"liyuan.agent.json",
		"liyuan.agent.meta.json",
		"liyuan-preset.json",
		".liyuan-personas.json",
	]:
		p = ROOT / risky
		if p.exists():
			tracked = subprocess.run(
				["git", "ls-files", "--error-unmatch", risky],
				cwd=ROOT,
				capture_output=True,
			)
			if tracked.returncode == 0:
				hits.append(f"TRACKED personal file: {risky}")

	print(f"scanned git-tracked text files; hits={len(hits)}")
	for h in hits:
		print("HIT", h)
	return 1 if hits else 0


if __name__ == "__main__":
	raise SystemExit(main())
