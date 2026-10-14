# Windows PowerShell 5 treats native stderr warnings as errors when redirected.
# Every native command below is checked using its actual process exit code.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
Push-Location source/frontend
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências do frontend.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Falha no build do frontend.' }
    & npm.cmd run check:i18n
    if ($LASTEXITCODE -ne 0) { throw 'Falha na validação de traduções.' }
} finally { Pop-Location }
& python source/tools/gen_assets.py
if ($LASTEXITCODE -ne 0) { throw 'Falha ao incorporar interface.' }
$linuxRoot = & wsl -d HLDRIVE-build --exec wslpath -a $PSScriptRoot.Replace('\', '/')
if ($LASTEXITCODE -ne 0) { throw 'Ambiente WSL HLDRIVE-build indisponível.' }
$linuxRoot = $linuxRoot.Trim()
& wsl -d HLDRIVE-build --cd $linuxRoot --exec env LLVM_CONFIG=/usr/lib/llvm20/bin/llvm-config make -j4
if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação do payload.' }
$hash = (Get-FileHash -LiteralPath build/HLDRIVE.elf -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'build/HLDRIVE.elf.sha256'), "$hash  HLDRIVE.elf`n")
Write-Output 'Payload gerado: build/HLDRIVE.elf'
