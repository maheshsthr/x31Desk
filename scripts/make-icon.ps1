# x31Desk — generate the Windows app icon from the official logo.
# ---------------------------------------------------------------------------
# The supplied logo (`transparent.png`) is a 500x500 PNG with an alpha channel:
# a symbol on top and the "x31Desk" wordmark below it, on a transparent
# background. An app icon must be a square that reads at 16 px, so this builds
# one from the *symbol only* — nothing is redrawn, recoloured or substituted; the
# symbol is cropped from the original pixels and centred on a transparent square.
#
# The symbol's bounding box is found by scanning for visible pixels (alpha > 8)
# rather than hard-coded, so re-running this against a re-exported logo
# reproduces the same result. The source's own transparency is kept: the master
# and every size are 32 bpp ARGB, the `.ico` entries carry that alpha, and the
# AND mask is derived from it (a pixel is masked out where alpha < 128) so older
# consumers that fall back to the mask agree with the alpha channel.
#
# Requires Windows PowerShell / .NET (System.Drawing). Run manually when the
# logo changes; it is not part of the normal build.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
#
# Outputs: build/icon.ico (16-256 px), build/icon.png (512 px master).

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'transparent.png'
$outDir = Join-Path $root 'build'

if (-not (Test-Path $src)) { throw "logo not found: $src" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$srcBmp = [System.Drawing.Bitmap]::FromFile($src)
$w = $srcBmp.Width
$h = $srcBmp.Height

# --- Read the pixels once ---------------------------------------------------
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $srcBmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$srcBmp.UnlockBits($data)

# A pixel is content when it is visible; the RGB under a fully transparent pixel
# is not part of the artwork.
function Test-Ink([int]$x, [int]$y) {
  $o = $y * $script:stride + $x * 4
  return ($script:bytes[$o + 3] -gt 8)
}

# --- Find the symbol: the top band of content, above the wordmark -----------
$inBand = $false
$bandTop = 0
$symbolTop = -1
$symbolBottom = -1
for ($y = 0; $y -lt $h; $y++) {
  $hasInk = $false
  $rowOff = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $o = $rowOff + $x * 4
    if ($bytes[$o + 3] -gt 8) { $hasInk = $true; break }
  }
  if ($hasInk -and -not $inBand) { $bandTop = $y; $inBand = $true }
  elseif (-not $hasInk -and $inBand) {
    $symbolTop = $bandTop
    $symbolBottom = $y - 1
    break
  }
}
if ($symbolTop -lt 0) { throw 'no symbol band found' }

# Column extent within the symbol band.
$symbolLeft = $w
$symbolRight = -1
for ($x = 0; $x -lt $w; $x++) {
  for ($y = $symbolTop; $y -le $symbolBottom; $y++) {
    if (Test-Ink $x $y) {
      if ($x -lt $symbolLeft) { $symbolLeft = $x }
      if ($x -gt $symbolRight) { $symbolRight = $x }
      break
    }
  }
}

$sw = $symbolRight - $symbolLeft + 1
$sh = $symbolBottom - $symbolTop + 1
Write-Output "symbol box: x $symbolLeft..$symbolRight (w $sw), y $symbolTop..$symbolBottom (h $sh)"

# --- Compose a square master: symbol centred, ~78% fill, transparent --------
$content = [Math]::Max($sw, $sh)
$side = [int][Math]::Round($content / 0.78)
if ($side % 2 -ne 0) { $side += 1 }

$master = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($master)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$srcRect = New-Object System.Drawing.Rectangle $symbolLeft, $symbolTop, $sw, $sh
$dstRect = New-Object System.Drawing.Rectangle ([int](($side - $sw) / 2)), ([int](($side - $sh) / 2)), $sw, $sh
$g.DrawImage($srcBmp, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$srcBmp.Dispose()
Write-Output "square master: ${side}x${side}"

# --- Helpers ----------------------------------------------------------------
function Get-Square([System.Drawing.Bitmap]$masterBmp, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.Clear([System.Drawing.Color]::Transparent)
  $gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gr.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gr.DrawImage($masterBmp, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
  $gr.Dispose()
  return $bmp
}

# A classic 32 bpp DIB icon entry: BITMAPINFOHEADER + bottom-up BGRA + AND mask.
function Get-DibBytes([System.Drawing.Bitmap]$bmp) {
  $bw = $bmp.Width
  $bh = $bmp.Height
  $r = New-Object System.Drawing.Rectangle 0, 0, $bw, $bh
  $d = $bmp.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bs = $d.Stride
  $buf = New-Object byte[] ($bs * $bh)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $buf.Length)
  $bmp.UnlockBits($d)

  $ms = New-Object System.IO.MemoryStream
  $wtr = New-Object System.IO.BinaryWriter $ms
  $wtr.Write([UInt32]40)
  $wtr.Write([Int32]$bw)
  $wtr.Write([Int32]($bh * 2))
  $wtr.Write([UInt16]1)
  $wtr.Write([UInt16]32)
  $wtr.Write([UInt32]0)
  $wtr.Write([UInt32]($bw * $bh * 4))
  $wtr.Write([Int32]0)
  $wtr.Write([Int32]0)
  $wtr.Write([UInt32]0)
  $wtr.Write([UInt32]0)
  for ($y = $bh - 1; $y -ge 0; $y--) {
    $wtr.Write($buf, $y * $bs, $bw * 4)
  }

  # AND mask, bottom-up to match the XOR rows above: a bit is set where the
  # pixel is see-through, so mask-only consumers cut out the same shape the
  # alpha channel already describes.
  $maskRow = [int][Math]::Floor(($bw + 31) / 32) * 4
  $mask = New-Object byte[] ($maskRow * $bh)
  for ($by = 0; $by -lt $bh; $by++) {
    $srcY = $bh - 1 - $by
    $rowOff = $srcY * $bs
    $maskOff = $by * $maskRow
    for ($x = 0; $x -lt $bw; $x++) {
      if ($buf[$rowOff + $x * 4 + 3] -lt 128) {
        $byteIndex = $maskOff + [int][Math]::Floor($x / 8)
        $mask[$byteIndex] = $mask[$byteIndex] -bor (0x80 -shr ($x % 8))
      }
    }
  }
  $wtr.Write($mask, 0, $mask.Length)
  $wtr.Flush()
  return , $ms.ToArray()
}

# --- Build the .ico ---------------------------------------------------------
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($s in $sizes) {
  $bmp = Get-Square $master $s
  $images += , @{ size = $s; bytes = (Get-DibBytes $bmp) }
  $bmp.Dispose()
}

$ico = New-Object System.IO.MemoryStream
$wtr = New-Object System.IO.BinaryWriter $ico
$wtr.Write([UInt16]0)
$wtr.Write([UInt16]1)
$wtr.Write([UInt16]$images.Count)

$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
  $s = $img.size
  $dim = if ($s -ge 256) { 0 } else { $s }
  $wtr.Write([byte]$dim)
  $wtr.Write([byte]$dim)
  $wtr.Write([byte]0)
  $wtr.Write([byte]0)
  $wtr.Write([UInt16]1)
  $wtr.Write([UInt16]32)
  $wtr.Write([UInt32]$img.bytes.Length)
  $wtr.Write([UInt32]$offset)
  $offset += $img.bytes.Length
}
foreach ($img in $images) { $wtr.Write($img.bytes, 0, $img.bytes.Length) }
$wtr.Flush()

$icoPath = Join-Path $outDir 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
Write-Output "wrote $icoPath ($([Math]::Round((Get-Item $icoPath).Length/1KB,1)) KB, sizes: $($sizes -join ', '))"

# --- A 512 px PNG master, for non-Windows targets and reuse ----------------
$png = Get-Square $master 512
$pngPath = Join-Path $outDir 'icon.png'
$png.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$png.Dispose()
Write-Output "wrote $pngPath"

$master.Dispose()
