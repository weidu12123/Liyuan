# Pack Liyuan 1.0 release (Windows + Linux ready-to-run source kits)
# - No node_modules (small zip; start.bat/start.sh npm install on first run)
# - Prebuilt web/dist so no frontend toolchain required on first start
# - No personal configs / private cards / runtime data
# - UTF-8 zip via Python (Chinese paths safe on Linux)
#
# Usage:
#   powershell -NoProfile -File scripts\pack-release.ps1
#   powershell -NoProfile -File scripts\pack-release.ps1 -Target linux
#   powershell -NoProfile -File scripts\pack-release.ps1 -Target windows
param(
  [ValidateSet("both", "windows", "linux")]
  [string]$Target = "both"
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

Write-Host "[pack] Liyuan $ver  root=$prod"

if (-not (Test-Path "web\dist\index.html")) {
  Write-Host "[pack] building frontend..."
  npm run web:build
  if ($LASTEXITCODE -ne 0) { throw "web:build failed" }
}

$outDir = Join-Path (Split-Path $prod -Parent) "_release"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Stage-Clean {
  param([string]$StageRoot)
  if (Test-Path $StageRoot) { Remove-Item $StageRoot -Recurse -Force }
  $dest = Join-Path $StageRoot "Liyuan"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null

  # robocopy /XD matches directory names anywhere
  $xd = @(
    "node_modules",
    ".git",
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
    "tmp-*.png",
    "_privacy_scan.py", "_inspect_session.py"
  )
  $robArgs = @($prod, $dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
  foreach ($d in $xd) { $robArgs += "/XD"; $robArgs += $d }
  foreach ($f in $xf) { $robArgs += "/XF"; $robArgs += $f }
  & robocopy @robArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

  # Keep only default sample cards / lore (strip personal Chinese packs if present on disk)
  $cards = Join-Path $dest "assets\cards"
  if (Test-Path $cards) {
    Get-ChildItem $cards -File | Where-Object {
      $_.Name -notmatch '^(default_Seraphina\.(json|png))$'
    } | Remove-Item -Force -ErrorAction SilentlyContinue
  }
  $lore = Join-Path $dest "assets\lorebooks"
  if (Test-Path $lore) {
    Get-ChildItem $lore -File | Where-Object {
      $_.Name -ne "Eldoria.json"
    } | Remove-Item -Force -ErrorAction SilentlyContinue
  }

  # Drop test artifacts & huge maps from packages to shrink (runtime uses packages/*/dist js)
  $dropGlobs = @(
    "test",
    "scripts\drive-*.mjs",
    "scripts\smoke-*.mjs",
    "scripts\scenario-runner.mjs",
    "scripts\analyze-session.mjs",
    "scripts\_*.py",
    "scripts\_*.ps1"
  )
  foreach ($g in $dropGlobs) {
    $p = Join-Path $dest $g
    Get-Item $p -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  # optional: remove *.map under packages (not required at runtime)
  Get-ChildItem (Join-Path $dest "packages") -Recurse -Filter "*.map" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # Ship safe default configs from examples
  Copy-Item (Join-Path $dest "liyuan.config.example.json") (Join-Path $dest "liyuan.config.json") -Force
  Copy-Item (Join-Path $dest "liyuan.agent.example.json") (Join-Path $dest "liyuan.agent.json") -Force

  # README snippet for release
  $note = @"
# Liyuan Agent v$ver

## Windows
1. Install Node.js >= 22
2. Unzip, open the ``Liyuan`` folder
3. Double-click ``start.bat``
4. First run will ``npm install`` (needs network once), then open http://localhost:7620
5. Edit ``liyuan.agent.json`` and set your API key

## Linux / macOS
```bash
unzip Liyuan-*-linux.zip
cd Liyuan
chmod +x start.sh
./start.sh
```

## Notes
- No personal API keys or private character cards are included.
- Runtime data (sessions, uploads) is created locally after first run.
"@
  Set-Content -LiteralPath (Join-Path $dest "RELEASE.txt") -Value $note -Encoding UTF8
  return $dest
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
  'node_modules', '.git', '.liyuan', '.liyuan-cache',
  '.liyuan-artifacts', '.liyuan-codex', '.liyuan-lore',
  '.liyuan-media', '.liyuan-skills', '.liyuan-state',
  '.liyuan-uploads', '.rp-media', '.rp-uploads'
}
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
            # executable bit for start.sh on Unix extractors
            if abs_p.name == 'start.sh':
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

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stage = Join-Path $env:TEMP "liyuan-release-$stamp"
Write-Host "[pack] staging..."
$dest = Stage-Clean -StageRoot $stage

# LF for start.sh
$sh = Join-Path $dest "start.sh"
if (Test-Path $sh) {
  $t = [IO.File]::ReadAllText($sh) -replace "`r`n", "`n" -replace "`r", "`n"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($sh, $t, $utf8)
}

$built = @()
if ($Target -eq "both" -or $Target -eq "windows") {
  $zip = Join-Path $outDir "Liyuan-$ver-windows.zip"
  Write-Utf8Zip -SourceDir $dest -ZipPath $zip
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
  Write-Host "[pack] Windows: $zip ($mb MB)"
  $built += $zip
}
if ($Target -eq "both" -or $Target -eq "linux") {
  $zip = Join-Path $outDir "Liyuan-$ver-linux.zip"
  Write-Utf8Zip -SourceDir $dest -ZipPath $zip
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
  Write-Host "[pack] Linux:   $zip ($mb MB)"
  $built += $zip
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "[pack] done."
$built
