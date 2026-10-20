# x31Desk — derive the in-app logo assets from the official source image.
# ---------------------------------------------------------------------------
# The supplied logo (`transparent.png`) is a 500x500 PNG with an alpha channel:
# the symbol on top and the "x31Desk" wordmark below it, on a *transparent*
# background. The UI needs it in two forms, and both are *derived from the
# original pixels* — nothing is redrawn, recoloured, re-lettered or
# re-proportioned:
#
#   * src/assets/x31desk-logo.png  the full lockup (symbol + wordmark), trimmed of
#                                  the source's transparent margin and padded to a
#                                  square, so it scales and aligns cleanly.
#   * src/assets/x31desk-mark.png  the symbol alone, centred on a square, for
#                                  compact chrome (the sidebar's header row, the
#                                  favicon) where the wordmark would be unreadable.
#
# The transparency is kept: the source already carries its own alpha, so both
# outputs are written as 32 bpp ARGB with a fully transparent background. The
# bands are located by scanning for visible pixels (alpha > 8) rather than
# hard-coding, so re-running this against a re-exported logo reproduces the same
# result. The same geometry, in the same scan, drives `make-icon.ps1`.
#
# Requires Windows PowerShell / .NET (System.Drawing). Run manually when the logo
# changes; it is not part of the normal build.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-logo-assets.ps1
#
# Outputs: src/assets/x31desk-logo.png (384x384), src/assets/x31desk-mark.png
# (256x256). Both are square so the caller can size them by edge length; the
# resolutions cover the largest places they are shown (the splash and the side
# bar) at 3x with room to spare.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'transparent.png'
$outDir = Join-Path $root 'src\assets'

if (-not (Test-Path $src)) { throw "logo not found: $src" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$srcBmp = [System.Drawing.Bitmap]::FromFile($src)
$w = $srcBmp.Width
$h = $srcBmp.Height
Write-Output "source: ${w}x${h}"

# --- Read the pixels once (32 bpp ARGB) -------------------------------------
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $srcBmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$srcBmp.UnlockBits($data)

# A pixel is content when it is visible. The background is alpha 0, so the RGB
# under it (often 0,0,0 in a keyed PNG) must not be consulted.
function Test-Ink([int]$x, [int]$y) {
  $o = $y * $script:stride + $x * 4
  return ($script:bytes[$o + 3] -gt 8)
}

# --- Locate the content bands (symbol, then wordmark) ------------------------
$bands = @()
$inBand = $false
$bandTop = 0
for ($y = 0; $y -lt $h; $y++) {
  $hasInk = $false
  $rowOff = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $o = $rowOff + $x * 4
    if ($bytes[$o + 3] -gt 8) { $hasInk = $true; break }
  }
  if ($hasInk -and -not $inBand) { $bandTop = $y; $inBand = $true }
  elseif (-not $hasInk -and $inBand) { $bands += @{ top = $bandTop; bottom = $y - 1 }; $inBand = $false }
}
if ($inBand) { $bands += @{ top = $bandTop; bottom = $h - 1 } }
if ($bands.Count -eq 0) { throw 'no content bands found' }

function Get-BandBox($band) {
  $left = $w
  $right = -1
  for ($x = 0; $x -lt $w; $x++) {
    for ($y = $band.top; $y -le $band.bottom; $y++) {
      if (Test-Ink $x $y) {
        if ($x -lt $left) { $left = $x }
        if ($x -gt $right) { $right = $x }
        break
      }
    }
  }
  return @{ left = $left; right = $right; top = $band.top; bottom = $band.bottom }
}

$boxes = @()
foreach ($band in $bands) { $boxes += (Get-BandBox $band) }

$symbol = $boxes[0]
$full = @{
  left = ($boxes | ForEach-Object { $_.left } | Measure-Object -Minimum).Minimum
  right = ($boxes | ForEach-Object { $_.right } | Measure-Object -Maximum).Maximum
  top = ($boxes | ForEach-Object { $_.top } | Measure-Object -Minimum).Minimum
  bottom = ($boxes | ForEach-Object { $_.bottom } | Measure-Object -Maximum).Maximum
}

foreach ($box in $boxes) {
  Write-Output "band: x $($box.left)..$($box.right), y $($box.top)..$($box.bottom)"
}
Write-Output "full: x $($full.left)..$($full.right), y $($full.top)..$($full.bottom)"

# --- Compose a square asset from a source box, on transparency ---------------
function New-Square([hashtable]$box, [int]$outSize, [double]$fill) {
  $bw = $box.right - $box.left + 1
  $bh = $box.bottom - $box.top + 1

  $available = $outSize * $fill
  $scale = $available / [Math]::Max($bw, $bh)
  $dw = [int][Math]::Round($bw * $scale)
  $dh = [int][Math]::Round($bh * $scale)
  $dx = [int](($outSize - $dw) / 2)
  $dy = [int](($outSize - $dh) / 2)

  $bmp = New-Object System.Drawing.Bitmap $outSize, $outSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $srcRect = New-Object System.Drawing.Rectangle $box.left, $box.top, $bw, $bh
  $dstRect = New-Object System.Drawing.Rectangle $dx, $dy, $dw, $dh
  $g.DrawImage($script:srcBmp, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $bmp
}

# The mark keeps the Windows-icon framing (78% fill) so it matches build/icon.png.
$mark = New-Square $symbol 256 0.78
$markPath = Join-Path $outDir 'x31desk-mark.png'
$mark.Save($markPath, [System.Drawing.Imaging.ImageFormat]::Png)
$mark.Dispose()
Write-Output "wrote $markPath (256x256)"

# The full lockup gets a 4% margin so no anti-aliased edge is clipped.
$logo = New-Square $full 384 0.92
$logoPath = Join-Path $outDir 'x31desk-logo.png'
$logo.Save($logoPath, [System.Drawing.Imaging.ImageFormat]::Png)
$logo.Dispose()
Write-Output "wrote $logoPath (384x384)"

$srcBmp.Dispose()
