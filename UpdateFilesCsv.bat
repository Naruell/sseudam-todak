@echo off
setlocal

set "SSEUDAM_PROJECT_ROOT=%~dp0"

echo Updating Data\Files.csv from the Sound folder...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = $env:SSEUDAM_PROJECT_ROOT;" ^
  "$soundRoot = Join-Path $root 'Sound';" ^
  "$outputPath = Join-Path $root 'Data\Files.csv';" ^
  "$audioExtensions = @('.m4a', '.mp3', '.wav', '.ogg', '.aac', '.flac');" ^
  "$quote = [string][char]34;" ^
  "$rows = New-Object 'System.Collections.Generic.List[string]';" ^
  "Get-ChildItem -LiteralPath $soundRoot -Directory | Sort-Object Name | ForEach-Object {" ^
  "  $category = $_.Name;" ^
  "  $categoryPath = $_.FullName;" ^
  "  $prefix = (($category -split '_', 2)[0]).Substring(0, 1).ToUpperInvariant();" ^
  "  Get-ChildItem -LiteralPath $categoryPath -Directory | Sort-Object @{ Expression = { $m = [regex]::Match($_.Name, '^\d+'); if ($m.Success) { [int]$m.Value } else { [int]::MaxValue } } }, Name | ForEach-Object {" ^
  "    $folder = $_;" ^
  "    $numberMatch = [regex]::Match($folder.Name, '^\d+');" ^
  "    if ($numberMatch.Success) {" ^
  "      $id = $prefix + $numberMatch.Value;" ^
  "      $relativeFolder = $category + '/' + $folder.Name;" ^
  "      $fileNames = @(Get-ChildItem -LiteralPath $folder.FullName -File | Where-Object { $audioExtensions -contains $_.Extension.ToLowerInvariant() } | Sort-Object @{ Expression = { $m = [regex]::Match($_.BaseName, '\d+'); if ($m.Success) { [int]$m.Value } else { [int]::MaxValue } } }, Name | ForEach-Object Name);" ^
  "      if ($fileNames.Count -gt 0) {" ^
  "        $escapedFolder = $relativeFolder.Replace($quote, $quote + $quote);" ^
  "        $escapedFiles = ($fileNames -join ',').Replace($quote, $quote + $quote);" ^
  "        $rows.Add($id + ',' + $quote + $escapedFolder + $quote + ',' + $quote + $escapedFiles + $quote);" ^
  "      }" ^
  "    }" ^
  "  }" ^
  "};" ^
  "$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false);" ^
  "$lineFeed = [string][char]10;" ^
  "$content = if ($rows.Count -gt 0) { [string]::Join($lineFeed, [string[]]$rows) + $lineFeed } else { '' };" ^
  "[System.IO.File]::WriteAllText($outputPath, $content, $utf8WithoutBom);" ^
  "Write-Host ('Updated ' + $rows.Count + ' sound groups.');"

if errorlevel 1 (
  echo.
  echo Failed to update Data\Files.csv.
  if /I not "%~1"=="--no-pause" pause
  exit /b 1
)

echo Done.
if /I not "%~1"=="--no-pause" pause
