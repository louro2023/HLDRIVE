# Package the existing HLDRIVE logo for Payload Manager's 12,288-character limit.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$output = Join-Path $projectRoot 'repository'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$original = [System.Drawing.Image]::FromFile((Join-Path $projectRoot 'source/frontend/public/branding/icon.png'))
$bitmap = New-Object System.Drawing.Bitmap 128,128
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($original,0,0,128,128)
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
    $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),([long]88)
    $thumbnail = Join-Path $output 'hldrive-icon.jpg'
    $bitmap.Save($thumbnail,$codec,$parameters)
    $uri = 'data:image/jpeg;base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($thumbnail))
    if ($uri.Length -gt 12288) { throw 'Icon exceeds Payload Manager limit.' }
    $json = @{ icons = @{ hldrive = $uri } } | ConvertTo-Json -Depth 3
    [IO.File]::WriteAllText((Join-Path $output 'icons.json'), $json + "`n", (New-Object Text.UTF8Encoding $false))
    Write-Output "HLDRIVE thumbnail: 128x128, data URI $($uri.Length)/12288 characters"
} finally {
    $parameters.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $original.Dispose()
}
