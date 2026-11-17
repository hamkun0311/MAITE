param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Debug'
)
$ErrorActionPreference = 'Stop'
$maiteRoot = Split-Path -Parent $PSScriptRoot
$maiteAndroid = Join-Path $maiteRoot 'apps\mobile\android'
function Read-MaiteProperty([string]$Path, [string]$Name) {
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  $maiteLine = Get-Content -LiteralPath $Path | Where-Object { $_.StartsWith("$Name=") } | Select-Object -First 1
  if ($maiteLine) { return (($maiteLine -split '=', 2)[1]).Trim().Replace('\:', ':').Replace('\\', '\') }
  return $null
}
$maiteJava = Read-MaiteProperty (Join-Path $maiteAndroid '.gradle\config.properties') 'java.home'
if (!$maiteJava) { $maiteJava = $env:JAVA_HOME }
$maiteSdk = Read-MaiteProperty (Join-Path $maiteAndroid 'local.properties') 'sdk.dir'
if (!$maiteSdk) { $maiteSdk = $env:ANDROID_HOME }
if (!$maiteJava -or !(Test-Path -LiteralPath (Join-Path $maiteJava 'bin\java.exe'))) {
  throw 'Configure JDK 21 in Android Studio and .gradle/config.properties first.'
}
if (!$maiteSdk -or !(Test-Path -LiteralPath (Join-Path $maiteSdk 'platforms\android-36\android.jar'))) {
  throw 'Install Android SDK Platform 36 and configure local.properties first.'
}
$maiteNames = @('JAVA_HOME', 'ANDROID_HOME', 'MAITE_UPLOAD_STORE_FILE', 'MAITE_UPLOAD_STORE_PASSWORD', 'MAITE_UPLOAD_KEY_ALIAS', 'MAITE_UPLOAD_KEY_PASSWORD')
$maitePrevious = @{}
foreach ($maiteName in $maiteNames) { $maitePrevious[$maiteName] = [Environment]::GetEnvironmentVariable($maiteName, 'Process') }
Push-Location $maiteRoot
try {
  & npm.cmd run mobile:sync
  if ($LASTEXITCODE -ne 0) { throw 'Mobile web bundle/sync failed.' }
  $env:JAVA_HOME = $maiteJava
  $env:ANDROID_HOME = $maiteSdk
  $maiteTask = 'assembleDebug'
  if ($Configuration -eq 'Release') {
    $maiteSigningPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.maite\signing\maite-upload.json'
    if (!(Test-Path -LiteralPath $maiteSigningPath)) { throw 'Upload signing credentials are missing. See docs/ANDROID_ACCOUNT_SETUP.md.' }
    $maiteSigning = Get-Content -LiteralPath $maiteSigningPath -Raw | ConvertFrom-Json
    if ($maiteSigning.appId -ne 'com.oestewdio.maite' -or !(Test-Path -LiteralPath $maiteSigning.storeFile)) { throw 'The upload key does not match this app.' }
    $env:MAITE_UPLOAD_STORE_FILE = $maiteSigning.storeFile
    $env:MAITE_UPLOAD_STORE_PASSWORD = $maiteSigning.storePassword
    $env:MAITE_UPLOAD_KEY_ALIAS = $maiteSigning.keyAlias
    $env:MAITE_UPLOAD_KEY_PASSWORD = $maiteSigning.keyPassword
    $maiteTask = 'bundleRelease'
  }
  Set-Location $maiteAndroid
  & .\gradlew.bat --no-daemon $maiteTask
  if ($LASTEXITCODE -ne 0) { throw 'Android Gradle build failed.' }
  if ($Configuration -eq 'Release') { Write-Host "AAB: $maiteAndroid\app\build\outputs\bundle\release\app-release.aab" }
  else { Write-Host "APK: $maiteAndroid\app\build\outputs\apk\debug\app-debug.apk" }
} finally {
  Pop-Location
  foreach ($maiteName in $maiteNames) { [Environment]::SetEnvironmentVariable($maiteName, $maitePrevious[$maiteName], 'Process') }
}
