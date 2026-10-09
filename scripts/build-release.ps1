# CampUser - Windows 便携包一键打包
# 产物：release/campuser-win64-portable.zip（解压后双击 start-portable.bat 运行，无需安装）
# 前提：本仓库已执行过 npm install（node_modules/electron 必须存在）
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
  Write-Error '缺少 node_modules\electron\dist\electron.exe，请先执行 npm install'
}

$stage = 'release\stage\campuser'
if (Test-Path 'release\stage') { Remove-Item 'release\stage' -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# 运行所需文件（不含源码开发链与 node_modules 全量，仅 electron 运行时）
Copy-Item 'node_modules\electron\dist' "$stage\electron-dist" -Recurse
foreach ($item in 'main.js', 'preload.js', 'branding.js', 'package.json', 'start-portable.bat') {
  Copy-Item $item (Join-Path $stage $item)
}
foreach ($dir in 'src', 'core', 'adapters') {
  Copy-Item $dir (Join-Path $stage $dir) -Recurse
}
# 数据目录占位
New-Item -ItemType Directory -Path "$stage\data" -Force | Out-Null

$zip = 'release\campuser-win64-portable.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path 'release\stage\campuser' -DestinationPath $zip
Remove-Item 'release\stage' -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "[完成] $zip（$size MB）— 解压后双击 start-portable.bat 运行"
