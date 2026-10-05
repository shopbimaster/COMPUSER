@echo off
rem WakeUp 课程表 本地版 - Android APK 一键构建（Tauri 2）
rem 首次使用需一次性安装工具链，缺什么本脚本会给出对应指引：
rem   1) Rust:        https://rustup.rs  （安装后执行 rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android）
rem   2) Android Studio（含 SDK + NDK + JDK 17），并在系统变量设置 ANDROID_HOME 与 NDK_HOME
rem   3) 首次构建会自动执行 tauri android init 生成 gen/ 目录
setlocal
cd /d "%~dp0"

where rustc >nul 2>nul || (echo [缺失] Rust 未安装：请访问 https://rustup.rs 安装，并执行 rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android & goto :fail)
where cargo >nul 2>nul || (echo [缺失] cargo 未随 Rust 提供，请重装 Rust & goto :fail)
where java >nul 2>nul || (echo [缺失] JDK 未安装：请安装 Android Studio 自带 JDK 或 JDK 17 & goto :fail)
if "%ANDROID_HOME%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" (set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk") else (echo [缺失] ANDROID_HOME 未设置且未找到默认 SDK 路径：请安装 Android Studio 并设置 ANDROID_HOME / NDK_HOME & goto :fail)
)
if "%NDK_HOME%"=="" (echo [提示] NDK_HOME 未设置：若构建报 NDK 缺失，请将其指向 SDK 内的 ndk\<版本号> 目录)

echo [1/3] 组装前端资源 dist/ ...
node scripts/prepare-tauri.mjs || goto :fail

if not exist "src-tauri\gen\android" (
  echo [2/3] 初始化 Android 工程（首次）...
  npx -y @tauri-apps/cli@latest android init || goto :fail
) else (
  echo [2/3] Android 工程已存在，跳过 init
)

echo [3/3] 构建 APK（aarch64，首次需编译 Rust 依赖，约 10-30 分钟）...
npx -y @tauri-apps/cli@latest android build --apk --target aarch64 || goto :fail

if not exist "release" mkdir "release"
for /r "src-tauri\gen\android" %%f in (*-release-*.apk *-universal-release.apk) do (
  copy /y "%%f" "release\" >nul
)
echo.
echo [完成] APK 已输出到 release\ 目录
goto :eof

:fail
echo.
echo [失败] 构建未完成，请按上方提示处理后重试
exit /b 1
