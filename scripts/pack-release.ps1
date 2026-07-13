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

  # robocopy /XD matches directory names anywhere
  $xd = @(
    "node_modules",
    ".git",
    ".github",
    ".liyuan", ".liyuan-artifacts", ".liyuan-cache", ".liyuan-codex",
    ".liyuan-lore", ".liyuan-media", ".liyuan-skills", ".liyuan-state",
    ".liyuan-uploads", ".liyuan-audio", ".liyuan-worldline",
    ".rp-media", ".rp-uploads",
    ".playwright-mcp",
    "ab-test", "import-test", "liyuan-profiles"
  )
  $xf = @(
    "*.log", "*.tsbuildinfo", ".DS_Store", "Thumbs.db",
    "*.bak",
    ".liyuan-personas.json",
    "liyuan.config.json", "liyuan.agent.json", "liyuan.agent.meta.json",
    "liyuan-preset.json",
    "shot-*.png", "bug-*.png", "fix-*.png", "latest-ui.png",
    "white-screen-check.png",
    "tmp-*.png",
    "_privacy_scan.py", "_inspect_session.py"
  )
  $robArgs = @($prod, $dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
  foreach ($d in $xd) { $robArgs += "/XD"; $robArgs += $d }
  foreach ($f in $xf) { $robArgs += "/XF"; $robArgs += $f }
  & robocopy @robArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

  # Keep only Liyuan default_* sample cards (never ship ST/community demo packs
  # like Seraphina/Eldoria, nor personal Chinese test cards).
  $cards = Join-Path $dest "assets\cards"
  if (Test-Path $cards) {
    Get-ChildItem $cards -File | Where-Object {
      $_.Name -notmatch '^default_'
    } | Remove-Item -Force -ErrorAction SilentlyContinue
    # Explicitly drop ST leftovers if someone drops them back as default_*
    Get-ChildItem $cards -File | Where-Object {
      $_.Name -match '(?i)seraphina'
    } | Remove-Item -Force -ErrorAction SilentlyContinue
  }
  # Standalone lorebooks: strip all (Qingwu embeds its own character_book)
  $lore = Join-Path $dest "assets\lorebooks"
  if (Test-Path $lore) {
    Get-ChildItem $lore -File | Remove-Item -Force -ErrorAction SilentlyContinue
  }

  # Drop test / internal tooling from release tree
  $dropGlobs = @(
    "test",
    "scripts\drive-*.mjs",
    "scripts\smoke-*.mjs",
    "scripts\scenario-runner.mjs",
    "scripts\analyze-session.mjs",
    "scripts\probe-backstage.mjs",
    "scripts\rename-paths-once.mjs",
    "scripts\_*.py",
    "scripts\_*.ps1",
    "scripts\_*.sh",
    "TESTING.md",
    "docs\st-ux-inventory.md"
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
  foreach ($name in @("start.sh", "start.command", "deploy\install.sh")) {
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
skip_dirs = {
  'node_modules', '.git', '.github', '.liyuan', '.liyuan-cache',
  '.liyuan-artifacts', '.liyuan-codex', '.liyuan-lore',
  '.liyuan-media', '.liyuan-skills', '.liyuan-state',
  '.liyuan-uploads', '.rp-media', '.rp-uploads'
}
exec_names = {'start.sh', 'start.command', 'install.sh'}
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(stage):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
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
print(zip_path, zip_path.stat().st_size)
"@
  $pyFile = Join-Path $env:TEMP ("liyuan-rel-zip-{0}.py" -f [guid]::NewGuid().ToString("n"))
  Set-Content -LiteralPath $pyFile -Value $py -Encoding UTF8
  python $pyFile
  if ($LASTEXITCODE -ne 0) { throw "python zip failed" }
  Remove-Item $pyFile -Force -ErrorAction SilentlyContinue
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
