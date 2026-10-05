@echo off
rem WakeUp 课程表 便携版启动（使用随包分发的 Electron 运行时，无需 Node 环境）
cd /d "%~dp0"
start "" "electron-dist\electron.exe" .
