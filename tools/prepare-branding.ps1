# Derive deployment-sized assets from the original HLDRIVE artwork.
# Originals remain unchanged in assets/branding.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$outputRoot = Join-Path $projectRoot 'source/frontend/public/branding'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
function Export-Art([string]$sourceName, [string]$targetName, [int]$width, [bool]$jpeg) {
    $original = [System.Drawing.Image]::FromFile((Join-Path $projectRoot "assets/branding/$sourceName"))
    $height = [int][Math]::Round($original.Height * $width / $original.Width)
    $bitmap = New-Object System.Drawing.Bitmap $width,$height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($original,0,0,$width,$height)
        $target = Join-Path $outputRoot $targetName
        if ($jpeg) {
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
            $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),([long]88)
            try { $bitmap.Save($target,$codec,$parameters) } finally { $parameters.Dispose() }
        } else { $bitmap.Save($target,[System.Drawing.Imaging.ImageFormat]::Png) }
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $original.Dispose() }
}
Export-Art 'hldrive-tile-v1.png' 'tile.png' 256 $false
Export-Art 'hldrive-icon-v1.png' 'icon.png' 128 $false
Export-Art 'hldrive-hero-v1.png' 'hero.jpg' 1600 $true
Export-Art 'hldrive-cover-v1.png' 'cover.jpg' 512 $true
Get-ChildItem -LiteralPath $outputRoot | Select-Object Name,Length
