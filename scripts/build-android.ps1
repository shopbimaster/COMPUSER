# CAMPUSER Android APK 构建（免管理员/开发者模式）
# 背景：Tauri CLI 用符号链接把 .so 链入 jniLibs，无 SeCreateSymbolicLink 权限会失败。
# 本脚本：cargo 构建 aarch64 → 真实拷贝 .so → 跳过 CLI 任务由 gradle 组装签名 APK。
# 产物：src-tauri/gen/android/app/build/outputs/apk/arm64/release/*.apk
#      （并拷贝到 release/CAMPUSER-<ver>-android-arm64.apk）
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$env:CARGO_HOME = 'D:\VScode\rust\cargo'
$env:RUSTUP_HOME = 'D:\VScode\rust\rustup'
$env:JAVA_HOME = 'D:\VScode\Java\jdk-21.0.12.1+1'
$env:ANDROID_HOME = 'D:\VScode\android-sdk'
$env:NDK_HOME = 'D:\VScode\android-sdk\ndk\27.1.12297006'
$env:GRADLE_USER_HOME = 'D:\VScode\gradle-home'
$env:Path = "D:\VScode\rust\cargo\bin;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

Set-Location $root
node scripts/prepare-tauri.mjs

# 1) Rust aarch64 release（NDK clang 作链接器——Tauri CLI 原本注入的环境）
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = "$env:NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android24-clang.cmd"
Set-Location "$root\src-tauri"
cargo build --release --target aarch64-linux-android
if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }

# 2) 真实拷贝 .so（替代 CLI 的符号链接）
$so = "$root\src-tauri\target\aarch64-linux-android\release\libcampuser_lib.so"
$dst = "$root\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item $so "$dst\libcampuser_lib.so" -Force
Write-Host "[so] staged $([math]::Round((Get-Item $so).Length / 1MB)) MB -> jniLibs\arm64-v8a"

# 3) gradle 组装（跳过 CLI 任务）+ 发布签名（keystore.properties 存在时自动生效）
$env:CAMPUSER_SKIP_RUST_BUILD = '1'
Set-Location "$root\src-tauri\gen\android"
& .\gradlew.bat assembleArm64Release --console=plain
if ($LASTEXITCODE -ne 0) { throw 'gradle assemble failed' }

# 4) 收集产物
$apk = Get-ChildItem "$root\src-tauri\gen\android\app\build\outputs\apk\arm64\release\*.apk" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$ver = (Get-Content "$root\src-tauri\tauri.conf.json" | ConvertFrom-Json).version
$out = "$root\release\CAMPUSER-$ver-android-arm64.apk"
New-Item -ItemType Directory -Force -Path "$root\release" | Out-Null
Copy-Item $apk.FullName $out -Force
Write-Host "[done] $out（$([math]::Round($apk.Length / 1MB, 1)) MB）"
