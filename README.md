# campuser

**campuser = campus + er，意为校园里的人。** 品牌显示名统一小写；当前产品为本地课表工具。

## 开发

需要 Node.js 与已安装的项目依赖。使用 `npm ci` 还原依赖，然后：

```sh
npm start                 # Electron 桌面版
npm run serve             # 浏览器：http://127.0.0.1:8766/src/index.html
npm test                  # 领域、存储故障注入、模块与 DOM 流程测试
npm run prepare-tauri     # 品牌同步 + 组装 dist/app、core、adapters
npm run test:smoke        # 实际 Chromium 验证 src 与 dist，两种屏幕宽度
cargo test --manifest-path src-tauri/Cargo.toml --lib --offline
```

`test:ui` 使用 Node 的实验性 VM 模块接口，出现对应提示属于预期。`test:smoke` 使用项目自带 Electron，创建临时用户目录和虚构课程，不访问实际课表；截图和结果保存在终端输出的系统临时目录。

Windows 安装包：`npm run dist`。本机已有 `.electron-builder-cache`；若默认缓存解压因符号链接权限失败，可在 PowerShell 设置 `$env:ELECTRON_BUILDER_CACHE="$PWD/.electron-builder-cache"` 后重新构建。便携包：`npm run release`。Android：`npm run apk`，需先配置 Rust Android target、JDK、Android SDK/NDK；本机无符号链接权限时可用 `scripts/build-android.ps1`。该辅助脚本仍保留原有本机工具链路径，需要其他开发者按机器调整。

## 代码结构

- `branding.js`：品牌显示名、导出前缀、应用 ID 的唯一来源。品牌同步脚本覆盖 Electron、HTML、Tauri/Cargo、Android strings 和 NSIS。
- `core/`：模型、周计算、调课、冲突、合并、编解码；`persistence.js` 负责存储校验、恢复选择与顺序保存。
- `adapters/`：Electron、Tauri、浏览器端口；`file-storage.js` 实现 Electron 文件事务。
- `src/js/app.mjs`：应用启动和模块组装。
- `src/js/ui/`：显式导入的 ES 模块。`context` 管理共享会话与通用函数；`grid`、`course-editor`、`schedules`、`settings`、`today`、`adjustments`、`imports`、`transfer` 分工处理业务界面；`events` 绑定入口；`storage-ui` 管理保存状态和失败恢复。
- `src-tauri/src/storage.rs`：Tauri 原子写入、自动备份、损坏文件保留和并发检查。

保留原生 JS 和现有视觉。UI 模块间可通过函数互相调用，初始化仅由 `app.mjs` 驱动；新增代码应显式声明依赖，不再添加隐式全局变量。平台能力只经 `Ports` 调用。

## 数据保护

文件端保存按“校验 → 检查原版本 → 备份上一版 → 临时文件写入并同步 → 原子替换”执行。Rust 命令用互斥锁串行化。UI 等待确认后才提示成功。

- 主文件：`schedule.json`；上一版：`schedule.json.bak`。首次保存也创建恢复副本。
- 损坏且存在有效备份：恢复备份，损坏原文另存为 `schedule.json.corrupt-*`，不会拿损坏内容覆盖好备份。
- 主文件和备份均不可读：停止编辑并显示错误，保持原文件不变，不自动创建空课表覆盖。
- 未知数据版本：停止加载或导入，避免降级覆盖。
- 保存失败：当前修改保留在内存，暂时阻止继续编辑，可重试、导出未保存备份或明确放弃后重新加载。
- 多窗口修改：比较加载时的原文，发现其他窗口写入后拒绝覆盖。浏览器在支持 Web Locks 时同时串行化跨标签页写入。
- 浏览器采用独立 localStorage 备份键；配额和访问权限错误会向用户报告。

自动备份只保留上一版，不是长期历史，也不能替代独立文件备份。尚未成功保存的内存修改无法保证在强制结束进程或系统杀后台后保留；Electron 关闭窗口时会提示未保存状态。

数据目录和协议 ID 不因品牌文案改名而改变：`campuser-schedule/2`、`com.campuser.app` 保持兼容。历史 `wakeup-schedule-local` 目录、`wakeup-schedule-data` 键及第三方 ICS 测试标识有意保留；这些是兼容输入，不是产品名称。新分享口令使用 `CU0:` / `CU1:`，仍可读取旧 `WU0:` / `WU1:`；旧版本未必能读取新口令，跨版本分享可使用 JSON 文件。`CampuserModel` 等代码符号遵循 PascalCase，`CAMPUSER_BRAND` 等遵循常量命名，不代表品牌拼写。

## 验证范围与后续

自动测试覆盖保存失败、写入/同步/替换中断、损坏恢复、旧版迁移、特殊 ID 合并、自定义时间段保留、课程增改删、设置、导入导出与模块启动。Chromium 冒烟验证桌面、390px 手机宽度以及 Tauri 资源目录。

Android release 清单移除网络权限，debug 可使用本地开发服务器。实际发布还需真机验证系统文件选择器、低存储空间、升级安装及厂商 WebView 差异；iOS 尚未提供工程。未来同步功能不能直接把当前 LWW 合并器视作完整的分布式同步方案。
