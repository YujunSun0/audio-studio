# Audio Studio launcher.
#   .\start.ps1          build the UI if needed, start the server, open the browser
#   .\start.ps1 -Dev     backend with auto-reload + Vite dev server (hot reload) on :5173
#
# Saved as UTF-8 *with BOM*: Windows PowerShell 5.1 reads BOM-less files as CP949.

param([switch]$Dev)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$url = 'http://127.0.0.1:8000'

function Pause-AndExit([int]$code) {
    Write-Host ''
    Read-Host '창을 닫으려면 Enter를 누르세요' | Out-Null
    exit $code
}

# Any uncaught error: show it and keep the window open instead of vanishing.
trap {
    Write-Host ''
    Write-Host "오류: $_" -ForegroundColor Red
    Pause-AndExit 1
}

# Turn off QuickEdit for this console window. With it on, a single click inside the
# window starts a text selection and Windows blocks every write to the console,
# which freezes the server mid-log (it then stops answering requests).
try {
    Add-Type -Namespace AudioStudio -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint mode);
'@
    $hIn = [AudioStudio.Console]::GetStdHandle(-10)  # STD_INPUT_HANDLE
    $mode = 0
    if ([AudioStudio.Console]::GetConsoleMode($hIn, [ref]$mode)) {
        # clear ENABLE_QUICK_EDIT_MODE (0x40), keep ENABLE_EXTENDED_FLAGS (0x80) so it sticks
        [void][AudioStudio.Console]::SetConsoleMode($hIn, ($mode -band (-bnot 0x40)) -bor 0x80)
    }
} catch {}

# Already running? Just open it instead of failing to bind the port.
$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $ours = $false
    try { $ours = (Invoke-RestMethod "$url/api/health" -TimeoutSec 3).ok } catch {}
    if ($ours -and -not $Dev) {
        Write-Host 'Audio Studio가 이미 실행 중이에요. 브라우저를 열게요.' -ForegroundColor Green
        Start-Process $url
        Start-Sleep 2
        exit 0
    }
    $proc = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    if ($ours) { throw "이미 Audio Studio가 실행 중이에요 (PID $($listener.OwningProcess)). 그 창을 닫고 다시 실행해 주세요." }
    throw "8000번 포트를 다른 프로그램($proc, PID $($listener.OwningProcess))이 쓰고 있어요. 그 프로그램을 종료하고 다시 실행해 주세요."
}

$env:UV_PROJECT_ENVIRONMENT = Join-Path $env:LOCALAPPDATA 'AudioStudio\.venv'

$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
    # Known install locations (winget package dir, winget links, standalone installer).
    $uv = @(
        Get-Item "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\astral-sh.uv_*\uv.exe" -ErrorAction SilentlyContinue
        Get-Item "$env:LOCALAPPDATA\Microsoft\WinGet\Links\uv.exe" -ErrorAction SilentlyContinue
        Get-Item "$env:USERPROFILE\.local\bin\uv.exe" -ErrorAction SilentlyContinue
    ) | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $uv) { throw 'uv를 찾을 수 없어요. 먼저 설치해 주세요: winget install astral-sh.uv' }

Write-Host 'Python 패키지 확인 중...'
Push-Location (Join-Path $root 'backend')
& $uv sync --python 3.12 --quiet
if ($LASTEXITCODE -ne 0) { throw 'Python 패키지 설치에 실패했어요.' }
Pop-Location

$frontend = Join-Path $root 'frontend'
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host '프론트엔드 패키지 설치 중...'
    Push-Location $frontend; npm install; Pop-Location
}

if ($Dev) {
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; npm run dev"
    Push-Location (Join-Path $root 'backend')
    & $uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
    Pop-Location
    exit 0
}

if (-not (Test-Path (Join-Path $frontend 'dist\index.html'))) {
    Write-Host '화면 빌드 중...'
    Push-Location $frontend; npm run build; Pop-Location
}

# Open the browser once the server actually answers.
Start-Job -ArgumentList $url {
    param($u)
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-RestMethod "$u/api/health" -TimeoutSec 2 | Out-Null; Start-Process $u; return } catch { Start-Sleep -Milliseconds 500 }
    }
} | Out-Null

Write-Host ''
Write-Host "Audio Studio 실행 중: $url" -ForegroundColor Green
Write-Host '끄려면 이 창을 닫거나 Ctrl+C를 누르세요.'
Write-Host ''
Push-Location (Join-Path $root 'backend')
& $uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8000
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
    Write-Host "서버가 종료됐어요 (코드 $code)." -ForegroundColor Yellow
    Pause-AndExit $code
}
