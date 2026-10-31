# Pack Liyuan release kits (Windows + Linux + macOS)
# - No node_modules (small zip; first-run npm install)
# - Prebuilt web/dist so no frontend toolchain required on first start
# - No personal configs / private cards / runtime data
# - UTF-8 zip via Python (Chinese paths safe on Unix)
# - SHA256SUMS.txt next to the zips
#
# Usage:
#   powershell -NoProfile -File scripts\pack-release.ps1
#   powershell -NoProfile -File scripts\pack-release.ps1 -Target all
#   powershell -NoProfile -File scripts\pack-release.ps1 -Target macos
#   powershell -NoProfile -File scripts\pack-release.ps1 -Target windows
param(
  # "both" kept as alias of windows+linux (legacy); prefer "all" for 3 platforms
  [ValidateSet("all", "both", "windows", "linux", "macos")]
  [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$prod = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $prod "package.json"))) {
  throw "package.json not found at $prod"
}
Set-Location $prod

$pkg = Get-Content (Join-Path $prod "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = [string]$pkg.version
if (-not $ver) { $ver = "1.0.0" }

Write-Host "[pack] Liyuan $ver  root=$prod  target=$Target"

if (-not (Test-Path "web\dist\index.html")) {
  Write-Host "[pack] building frontend..."
  npm run web:build
  if ($LASTEXITCODE -ne 0) { throw "web:build failed" }
}

$outDir = Join-Path (Split-Path $prod -Parent) "_release"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Write-PlatformReleaseNote {
  param([string]$Dest, [string]$Platform, [string]$Version)

  $common = @"

## Requirements
- Node.js **>= 22** (https://nodejs.org/)
- Network on **first run** only (``npm install``); later starts are offline-ready
- Any OpenAI-compatible API key (e.g. DeepSeek)

## After start
1. Browser opens ``http://127.0.0.1:7620`` (or open it yourself)
2. Edit ``liyuan.agent.json`` -> set ``apiKey`` and model id
3. Built-in demo card: ``assets/cards/default_Qingwu.json`` (Liyuan original; not from SillyTavern)

## Notes
- No personal API keys or private character cards are included.
- Runtime data (sessions, uploads, panels) is created under this folder after first run.
- License: PolyForm Noncommercial 1.0.0 - personal / non-commercial use.
  See LICENSE. Commercial use needs separate permission.
- Server deploy / Docker: see ``deploy/README.md`` and ``docker-compose.yml``.
  Do **not** expose port 7620 to the public internet without auth / reverse proxy.

"@

  switch ($Platform) {
    "windows" {
      $body = @"
# Liyuan Agent v$Version - Windows

## Quick start
1. Install Node.js >= 22 and ensure ``node`` / ``npm`` are on PATH
2. Unzip this archive
3. Open the ``Liyuan`` folder
4. Double-click ``start.bat``
5. First run runs ``npm install`` (needs network once), then starts the server

## New session
``start.bat --new``

$common
"@
    }
    "linux" {
      $body = @"
# Liyuan Agent v$Version - Linux

## Quick start
``````bash
unzip Liyuan-$Version-linux.zip
cd Liyuan
chmod +x start.sh
./start.sh
``````

## New session
``````bash
./start.sh --new
``````

## Optional
- Skip auto browser: ``OPEN_BROWSER=0 ./start.sh``
- Custom port: ``PORT=8080 ./start.sh``

## Headless / VPS
Prefer Docker or ``deploy/install.sh`` (systemd). See ``deploy/README.md``.

$common
"@
    }
    "macos" {
      $body = @"
# Liyuan Agent v$Version - macOS

Apple Silicon (M1/M2/M3/M4) and Intel both work: this is a source kit;
native optional deps are installed by ``npm`` on your machine.

## Quick start (recommended)
1. Install Node.js >= 22
   - https://nodejs.org/  **or**
   - Homebrew: ``brew install node@22`` then link if needed
2. Unzip this archive (double-click in Finder is fine)
3. Open the ``Liyuan`` folder
4. Double-click ``start.command``
   - First time: if macOS blocks it -> System Settings -> Privacy & Security -> Allow
   - Or right-click -> Open
5. First run runs ``npm install`` (needs network once), then opens the browser

## Terminal alternative
``````bash
cd /path/to/Liyuan
chmod +x start.sh start.command
./start.sh
``````

## New session
Double-click ``start.command`` after editing is not enough for flags -
use Terminal: ``./start.sh --new``

## If macOS says the app is damaged / cannot be opened
Downloads from a browser get a quarantine flag. Clear it once:
``````bash
xattr -dr com.apple.quarantine /path/to/Liyuan
``````
Then double-click ``start.command`` again.

## Optional
- Skip auto browser: ``OPEN_BROWSER=0 ./start.sh``
- Custom port: ``PORT=8080 ./start.sh``

$common
"@
    }
    default {
      $body = "# Liyuan Agent v$Version`n"
    }
  }

  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText((Join-Path $Dest "RELEASE.txt"), ($body -replace "`r`n", "`n" -replace "`r", "`n"), $utf8)
}

function Stage-Clean {
  param([string]$StageRoot)
  if (Test-Path $StageRoot) { Remove-Item $StageRoot -Recurse -Force }
  $dest = Join-Path $StageRoot "Liyuan"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null

  # robocopy /XD matches directory names anywhere.
  # NOTE: ".liyuan" is excluded wholesale (it holds user settings/sessions),
  # so the product wiring layer ".liyuan/extensions" is re-copied explicitly below.
  # Without it the shipped app silently loses ALL RP commands/tools (v1.0.0-v1.1.0 bug).
  $xd = @(
    "node_modules",
    ".git",
    ".github",
    ".claude",
    ".liyuan", ".liyuan-artifacts", ".liyuan-assistant", ".liyuan-cache", ".liyuan-codex",
    ".liyuan-lore", ".liyuan-media", ".liyuan-memory", ".liyuan-skills", ".liyuan-state",
    ".liyuan-uploads", ".liyuan-audio", ".liyuan-worldline",
    ".rp-media", ".rp-uploads",
    ".playwright-mcp",
    ".superpowers", "superpowers",
    "scratch", "summaries", "output", "persist", "artifacts",
    "ab-test", "import-test", "liyuan-profiles",
    "data",
    # 桌面版为独立 Electron 封装（构建产物 app/dist/node_modules），源码包不包含
    "desktop",
    # 卡＝工作空间：cards/<卡文件夹>/ 整棵是用户私有数据（卡本体 + 卡级配置 +
    # 每个子项目的会话/账本/世界线）。漏掉这一行 = 把用户的卡打进公开发布包。
    "cards",
    "gen", "presets",
    # 资料保护（刀3）：快照对象仓与回收站都是用户数据（可能含卡/世界书正文），绝不随包
    ".vault", ".回收站", "assets/.vault", "assets/.回收站"
  )
  $xf = @(
    "*.log", "*.tsbuildinfo", ".DS_Store", "Thumbs.db",
    "*.bak",
    ".liyuan-personas.json",
    ".liyuan-mcp.json",
    ".mcp.json",
    "liyuan.config.json", "liyuan.agent.json", "liyuan.agent.meta.json",
    "liyuan-preset.json",
    "shot-*.png", "bug-*.png", "fix-*.png", "latest-ui.png",
    "white-screen-check.png",
    "tmp-*.png", "liyuan-*.png",
    "debug-fanren.html", "_verify-*.mjs", "_check-*.mjs",
    "_privacy_scan.py", "_inspect_session.py"
  )
  $robArgs = @($prod, $dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
  foreach ($d in $xd) { $robArgs += "/XD"; $robArgs += $d }
  foreach ($f in $xf) { $robArgs += "/XF"; $robArgs += $f }
  & robocopy @robArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

  # Product wiring layer: the ONLY code inside .liyuan/ (git-tracked). Ship it.
  $extSrc = Join-Path $prod ".liyuan\extensions"
  $extDst = Join-Path $dest ".liyuan\extensions"
  New-Item -ItemType Directory -Force -Path $extDst | Out-Null
  Copy-Item (Join-Path $extSrc "*.ts") $extDst -Force
  if (-not (Test-Path (Join-Path $extDst "roleplay.ts"))) {
    throw "PACK BUG: .liyuan/extensions/roleplay.ts missing from stage - release would ship without RP layer"
  }

  # /XD data also excludes pi's generated model catalogs. Only these product
  # JSON assets are restored; the user-data exclusion above stays in effect.
  foreach ($catalogRoot in @("packages\ai\src\providers\data", "packages\ai\dist\providers\data")) {
    $catalogSrc = Join-Path $prod $catalogRoot
    $catalogDst = Join-Path $dest $catalogRoot
    if (-not (Test-Path -LiteralPath (Join-Path $catalogSrc ".manifest.json"))) {
      throw "PACK BUG: pi model catalog is missing from $catalogRoot"
    }
    New-Item -ItemType Directory -Force -Path $catalogDst | Out-Null
    Get-ChildItem -LiteralPath $catalogSrc -File -Force -Filter "*.json" |
      Copy-Item -Destination $catalogDst -Force
  }

  # Keep only Liyuan default_* sample cards (never ship ST/community demo packs
  # like Seraphina/Eldoria, nor personal Chinese test cards).
  # NOTE: /XD cards matches directory names anywhere and also excludes assets/cards.
  # Explicitly restore default_* sample cards into assets/cards.
  $cardsSrc = Join-Path $prod "assets\cards"
  $cardsDst = Join-Path $dest "assets\cards"
  New-Item -ItemType Directory -Force -Path $cardsDst | Out-Null
  if (Test-Path $cardsSrc) {
    Get-ChildItem $cardsSrc -File | Where-Object {
      $_.Name -match '^default_' -and $_.Name -notmatch '(?i)seraphina'
    } | Copy-Item -Destination $cardsDst -Force
  }
  # Standalone lorebooks: strip all (Qingwu embeds its own character_book)
  $lore = Join-Path $dest "assets\lorebooks"
  if (Test-Path $lore) {
    Get-ChildItem $lore -File | Remove-Item -Force -ErrorAction SilentlyContinue
  }

  # User presets: never ship. assets/presets/ is personal/community data (and
  # gitignored), already excluded via /XD above — this is belt-and-suspenders
  # against future edits removing that exclusion. Runtime mkdirSync's the dir.
  $presets = Join-Path $dest "assets\presets"
  if (Test-Path $presets) {
    Remove-Item $presets -Recurse -Force -ErrorAction SilentlyContinue
  }

  # 资料保护（刀3）：快照对象仓与回收站二次防御清除
  foreach ($leakDir in @(".vault", ".回收站")) {
    $p = Join-Path $dest "assets\$leakDir"
    if (Test-Path $p) {
      Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  # Drop test / internal tooling from release tree
  $dropGlobs = @(
    "test",
    "packages\*\test",
    "scripts\drive-*.mjs",
    "scripts\smoke-*.mjs",
    "scripts\check-*.mjs",
    "scripts\debug-*.mjs",
    "scripts\find-*.mjs",
    "scripts\live-*.mjs",
    "scripts\probe-*.mjs",
    "scripts\verify-*.mjs",
    "scripts\write-*.mjs",
    "scripts\build-fanren-*.mjs",
    "scripts\_*.mjs",
    "web\public\debug-fanren.html",
    "web\dist\debug-fanren.html",
    "scripts\_*.py",
    "scripts\_*.ps1",
    "scripts\_*.sh",
    # root-level dev scratch (underscore convention) + probe dumps
    "_*",
    "TESTING.md",
    "CLAUDE.md",
    # 根 AGENTS.md 同为开发者指令（铁律/src 索引/测试命令）；扮演会话的
    # ResourceLoader 已按路径滤掉它，发布包也不再分发（cards/ 内的不受影响）
    "AGENTS.md",
    "docs\st-ux-inventory.md",
    "docs\superpowers",
    # 内部架构设计文档：研发过程记录（含逆向分析路径、未修问题定位、
    # 被数据推翻的自我结论），仓库里可见即可，不随发布包分发
    "docs\PLAN-*.md",
    "docs\REVIEW-*.md",
    "docs\DRAFT-*.md",
    "docs\FINDINGS-*.md",
    "docs\PI-RETURN-*.md",
    "docs\PRESET-SPLIT-TAXONOMY.md",
    # 内部文档（含本地绝对路径/会话定位，仅仓库可见）+ 预设装载期生成物（用户数据）
    "docs\READING-THINKING.md",
    "skills\预设-*"
  )
  foreach ($g in $dropGlobs) {
    $p = Join-Path $dest $g
    Get-Item $p -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  # source maps not required at runtime
  Get-ChildItem (Join-Path $dest "packages") -Recurse -Filter "*.map" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # Ship safe default configs from examples
  Copy-Item (Join-Path $dest "liyuan.config.example.json") (Join-Path $dest "liyuan.config.json") -Force
  Copy-Item (Join-Path $dest "liyuan.agent.example.json") (Join-Path $dest "liyuan.agent.json") -Force

  # Placeholder RELEASE - replaced per platform before zip
  Set-Content -LiteralPath (Join-Path $dest "RELEASE.txt") -Value "# Liyuan Agent v$ver" -Encoding UTF8
  return $dest
}

function Normalize-UnixScripts {
  param([string]$Dest)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  foreach ($name in @("start.sh", "start.command", "docker-entrypoint.sh", "deploy\install.sh")) {
    $p = Join-Path $Dest $name
    if (Test-Path $p) {
      $t = [IO.File]::ReadAllText($p) -replace "`r`n", "`n" -replace "`r", "`n"
      [IO.File]::WriteAllText($p, $t, $utf8)
    }
  }
}

function Write-Utf8Zip {
  param([string]$SourceDir, [string]$ZipPath)
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  $py = @"
import zipfile, os
from pathlib import Path
stage = Path(r'''$SourceDir''')
zip_path = Path(r'''$ZipPath''')
# NOTE: '.liyuan' must NOT be skipped here - the stage only contains
# .liyuan/extensions (product code); user data dirs were excluded at stage time.
skip_dirs = {
  'node_modules', '.git', '.github', '.liyuan-cache',
  '.liyuan-artifacts', '.liyuan-assistant', '.liyuan-codex', '.liyuan-lore',
  '.liyuan-media', '.liyuan-memory', '.liyuan-skills', '.liyuan-state',
  '.liyuan-uploads', '.liyuan-audio', '.liyuan-worldline',
  '.rp-media', '.rp-uploads',
  'desktop', 'artifacts'
}
exec_names = {'start.sh', 'start.command', 'install.sh', 'docker-entrypoint.sh'}
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(stage):
        # Only exclude root-level cards/ (user workspaces); assets/cards holds default demo cards
        dirs[:] = [d for d in dirs if not (Path(root) == stage and d == 'cards') and d not in skip_dirs]
        for f in files:
            if f.endswith(('.log', '.bak', '.tsbuildinfo')):
                continue
            abs_p = Path(root) / f
            rel = Path('Liyuan') / abs_p.relative_to(stage)
            zi = zipfile.ZipInfo(rel.as_posix())
            zi.flag_bits |= 0x800
            zi.compress_type = zipfile.ZIP_DEFLATED
            if abs_p.name in exec_names:
                zi.external_attr = 0o755 << 16
            zf.writestr(zi, abs_p.read_bytes())
        # Preserve empty dirs (assets/lorebooks ends up empty after lorebooks are
        # stripped) — the Docker build context runs `cp -r assets/lorebooks`, which
        # fails when the directory is absent; zip has no dir entries unless added here.
        for d in dirs:
            abs_d = Path(root) / d
            if not any(abs_d.iterdir()):
                rel = Path('Liyuan') / abs_d.relative_to(stage)
                zi = zipfile.ZipInfo(rel.as_posix() + '/')
                zi.flag_bits |= 0x800
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o755 << 16
                zf.writestr(zi, b'')
print(zip_path, zip_path.stat().st_size)
"@
  $pyFile = Join-Path $env:TEMP ("liyuan-rel-zip-{0}.py" -f [guid]::NewGuid().ToString("n"))
  Set-Content -LiteralPath $pyFile -Value $py -Encoding UTF8
  python $pyFile
  if ($LASTEXITCODE -ne 0) { throw "python zip failed" }
  Remove-Item $pyFile -Force -ErrorAction SilentlyContinue
}

# Post-pack sanity check: a zip that fails any of these must never reach users.
# - MUST contain the RP wiring layer (.liyuan/extensions/roleplay.ts)
# - MUST NOT contain user data dirs / dev scratch / personal configs
function Test-ReleaseZip {
  param([string]$ZipPath)
  $py = @"
import sys, zipfile
z = zipfile.ZipFile(r'''$ZipPath''')
names = z.namelist()
errors = []
if not any(n.endswith('.liyuan/extensions/roleplay.ts') for n in names):
    errors.append('MISSING .liyuan/extensions/roleplay.ts (RP layer would not load)')
if not any(n.endswith('server/mcp/vision-server.mjs') for n in names):
    errors.append('MISSING server/mcp/vision-server.mjs (builtin vision MCP would not ship)')
if not any(n.endswith('assets/cards/default_Qingwu.json') for n in names):
    errors.append('MISSING assets/cards/default_Qingwu.json (default demo card missing)')
catalogs = []
for kind in ('src', 'dist'):
    prefix = f'Liyuan/packages/ai/{kind}/providers/data/'
    files = {n[len(prefix):] for n in names if n.startswith(prefix) and n.endswith('.json')}
    catalogs.append(files)
    if '.manifest.json' not in files or len(files) < 2:
        errors.append(f'MISSING pi model catalogs ({kind})')
if catalogs[0] != catalogs[1]:
    errors.append('MISMATCH pi source/runtime model catalogs')
forbidden_dirs = ['.liyuan-memory/', '.liyuan-state/', '.liyuan-uploads/', '.liyuan-lore/',
                  '.liyuan-codex/', '.liyuan-assistant/', '.liyuan-worldline/', '.liyuan-media/',
                  '.liyuan-audio/', '.liyuan-cache/', '.superpowers/', 'scratch/', 'summaries/',
                  'output/', 'persist/', 'artifacts/', 'test/', 'assets/presets/',
                  'assets/.vault/', 'assets/.回收站/']
for d in forbidden_dirs:
    hits = [n for n in names if ('/' + d) in n]
    if hits:
        errors.append(f'LEAK {d} ({len(hits)} entries, e.g. {hits[0]})')
junk = [n for n in names if n.count('/') == 1 and n.split('/')[1].startswith('_')]
if junk:
    errors.append(f'DEV SCRATCH at root: {junk[:5]}')
for f in ('.liyuan/settings.json', '.liyuan-personas.json', 'liyuan.agent.meta.json', '.liyuan-mcp.json', '.mcp.json'):
    if any(n.endswith('/' + f) or n.endswith(f) for n in names):
        errors.append(f'PERSONAL FILE {f}')
if errors:
    print('ZIP CHECK FAILED: ' + r'''$ZipPath''')
    for e in errors:
        print('  - ' + e)
    sys.exit(1)
print('zip check OK (%d entries)' % len(names))
"@
  $pyFile = Join-Path $env:TEMP ("liyuan-zip-check-{0}.py" -f [guid]::NewGuid().ToString("n"))
  Set-Content -LiteralPath $pyFile -Value $py -Encoding UTF8
  python $pyFile
  $code = $LASTEXITCODE
  Remove-Item $pyFile -Force -ErrorAction SilentlyContinue
  if ($code -ne 0) { throw "release zip failed sanity check: $ZipPath" }
}

function Write-Sha256Sums {
  param([string[]]$Files, [string]$OutDir)
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($f in $Files) {
    if (-not (Test-Path $f)) { continue }
    $hash = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
    $name = Split-Path $f -Leaf
    # GNU coreutils style: "<hash>  <filename>"
    $lines.Add("$hash  $name") | Out-Null
    Write-Host "[pack] SHA256 $name = $hash"
  }
  $sumPath = Join-Path $OutDir "SHA256SUMS.txt"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($sumPath, (($lines -join "`n") + "`n"), $utf8)
  Write-Host "[pack] checksums: $sumPath"
  return $sumPath
}

function Build-PlatformZip {
  param(
    [string]$Platform,
    [string]$BaseDest,
    [string]$StageRoot,
    [string]$OutDir,
    [string]$Version
  )
  $platStage = Join-Path $StageRoot "plat-$Platform"
  if (Test-Path $platStage) { Remove-Item $platStage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $platStage | Out-Null
  # Copy staged tree (robocopy for reliability on Windows)
  $platDest = Join-Path $platStage "Liyuan"
  & robocopy $BaseDest $platDest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy platform stage failed: $LASTEXITCODE" }

  Write-PlatformReleaseNote -Dest $platDest -Platform $Platform -Version $Version
  Normalize-UnixScripts -Dest $platDest

  # Platform-specific trims (optional, keep cross-files so mixed hosts still work)
  # macOS: keep start.command; windows/linux still ship it (harmless)

  $zip = Join-Path $OutDir "Liyuan-$Version-$Platform.zip"
  Write-Utf8Zip -SourceDir $platDest -ZipPath $zip
  Test-ReleaseZip -ZipPath $zip
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
  Write-Host "[pack] $Platform : $zip ($mb MB)"
  return $zip
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stage = Join-Path $env:TEMP "liyuan-release-$stamp"
Write-Host "[pack] staging..."
$dest = Stage-Clean -StageRoot $stage
Normalize-UnixScripts -Dest $dest

$wantWindows = $Target -in @("all", "both", "windows")
$wantLinux   = $Target -in @("all", "both", "linux")
$wantMacos   = $Target -in @("all", "macos")

$built = @()
if ($wantWindows) {
  $built += Build-PlatformZip -Platform "windows" -BaseDest $dest -StageRoot $stage -OutDir $outDir -Version $ver
}
if ($wantLinux) {
  $built += Build-PlatformZip -Platform "linux" -BaseDest $dest -StageRoot $stage -OutDir $outDir -Version $ver
}
if ($wantMacos) {
  $built += Build-PlatformZip -Platform "macos" -BaseDest $dest -StageRoot $stage -OutDir $outDir -Version $ver
}

$sum = Write-Sha256Sums -Files $built -OutDir $outDir
$built += $sum

# Copy GitHub release body template beside artifacts if present
$relNotesSrc = Join-Path $prod "docs\RELEASE-v$ver.md"
if (-not (Test-Path $relNotesSrc)) {
  $relNotesSrc = Join-Path $prod "docs\RELEASE-NOTES.md"
}
if (Test-Path $relNotesSrc) {
  $relNotesDst = Join-Path $outDir (Split-Path $relNotesSrc -Leaf)
  Copy-Item $relNotesSrc $relNotesDst -Force
  Write-Host "[pack] release notes: $relNotesDst"
  $built += $relNotesDst
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "[pack] done."
$built
