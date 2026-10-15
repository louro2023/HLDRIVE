# Build the frontend and PS5 ELF inside the configured Ubuntu WSL distribution.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$linuxRoot = & wsl.exe -d Ubuntu --exec wslpath -a ($PSScriptRoot.Replace('\', '/'))
if ($LASTEXITCODE -ne 0) { throw 'Ubuntu WSL or wslpath is unavailable.' }
$linuxRoot = $linuxRoot.Trim()
& wsl.exe -d Ubuntu --cd $linuxRoot --exec bash -lc 'bash build.sh'
if ($LASTEXITCODE -ne 0) { throw 'HLDRIVE build failed in Ubuntu WSL.' }
$hash = (Get-FileHash -LiteralPath 'build/HLDRIVE.elf' -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'build/HLDRIVE.elf.sha256'), "$hash  HLDRIVE.elf`n")
Write-Output 'Payload generated: build/HLDRIVE.elf'
