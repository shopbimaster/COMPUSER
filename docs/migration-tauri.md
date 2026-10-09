# CAMPUSER 跨平台迁移方案：Tauri 2（Android / iOS）

> 决策结论：**先迁移、后联网**。按「是否引入新平台端口」划线——纯 core 功能随时做；
> 碰平台（网络栈 / 存储 / 通知 / 扫码）的一律等迁移完成后做。迁移期只修 bug。

## 0. 背景与目标

- 现状：Electron 33 桌面版（Windows）已发布 v1.6.0；纯本地、无网络请求
- 目标平台：国产安卓家族（华为/小米/OPPO/vivo/荣耀）与 iOS；Electron 桌面版继续维护
- 定位约束：小而精的公益工具，不急扩展用户 → 无联网紧迫性，迁移优先级 > 新功能

## 1. 为什么先迁移（决策论证）

判据只有一条：**联网功能会不会引入新的平台端口**。

| 维度 | 先联网 | 先迁移（采纳） |
|---|---|---|
| 迁移成本 | 凭据存储 / HTTP 栈 / 远端状态按 Electron 写，迁移时双端重验 | 迁移后联网 = core 协议 + 新 Port，双端一次实现 |
| 需求风险 | 联网需求未定义，单端先行易范围膨胀 | 工作量确定、坑已探明 |
| 定位稀释 | 加入 HTTP 客户端即需隐私声明，稀释「纯本地可验证」卖点 | 无网络权限可验证的承诺继续成立 |
| 迁移债 | 新功能可能持续引入 Chromium 特有 API | 冻结期立即开始 |

反例：若联网功能是「教务对接导入课表」这类纯解析逻辑（core/ 内完成），不构成
迁移负担，可随时做。跨设备同步现阶段已被口令 / 二维码 / 文件互通覆盖
（campuser-schedule/2 三端同格式）。

## 2. 迁移后的分层纪律（历史包袱控制）

1. **core/ 只长逻辑**：业务规则、数据模型、（未来）网络协议状态机；配单测；
   数据格式向后兼容——新字段可选 + normalize 兜底，破坏性变更加 `/3` + migrate 链
2. **adapters/ 一平台一文件**：新功能先定义 Port 接口再逐端实现；
   `src/` 禁止直接触碰平台 API（只认 `window.__ports`）
3. **功能立项标注成本**：`[core]`（三端免费）/ `[port:xx]`（×平台数）/ `[ui]`（各端适配）
4. **不重写 UI 框架**：原生 JS 在移动 WebView 性能足够（低频重绘），
   仅当触屏交互受限再局部组件化

联网功能落位（解冻后）：`core/net/`（协议状态机）+ adapter 网络 Port +
Android 独立 flavor 申请 INTERNET 权限；**纯本地发行版永远不申请网络权限**。

## 3. 阶段计划与验收

### T0 工具链（本机，D:\VScode 布局）
- Rust stable（MSVC host）+ 4 个 Android target；VS Build Tools（VC++ + Windows SDK）
- Temurin JDK 21 LTS；Android cmdline-tools + platform-tools + platform 34 +
  build-tools 34 + NDK r27
- 环境变量（用户级）：JAVA_HOME / ANDROID_HOME / NDK_HOME / RUSTUP_HOME /
  CARGO_HOME / PATH 追加
- **验收**：新 shell 中 `cargo --version`、`java -version`、`adb --version` 正常；
  `cargo new` + `cargo build`（宿主）链接成功；`rustup target list --installed`
  含 4 个 Android 三元组
- 布局约定：一律装在 `D:\VScode\<工具名>\`（rust / jdk / android-sdk），PATH 指向
  其 bin；长期开发选 LTS / stable 线，不追新

### T1 tauri-bridge 适配器
- `Ports.storage` → Rust command 读写 app data 目录 schedule.json（同格式）
- `Ports.share.send` → Android share sheet / 桌面 plugin-dialog（解决 a.click() 不可靠）
- `Ports.share.receive` → plugin-dialog 选文件；进阶 intent-filter 注册 .ics/.json
- 扫码：zxing-wasm（WebView 可用）；Electron/浏览器保留 BarcodeDetector 优先
- 验收：桌面 Tauri 版功能与 Electron 版冒烟对齐（课表增删改查 / 导入导出 / 主题）

### T2 Android 真机适配
- v1.5.0 窄屏排查报告 4 项：顶栏三段互撞、设置时间表横向溢出、极窄列截断、
  （其余已过）；触摸目标 ≥44px；周切换手势
- 验收：360px 宽度零横向滚动；主流家族模拟器（华为/小米风格）无阻塞性问题

### T3 v2.0.0-alpha（Android）
- APK 直发（GitHub Release + 官网），不依赖应用商店；上架（软著 + 备案）后议
- AndroidManifest 不声明 INTERNET 权限（无网络可验证 = 信任卖点）
- 验收：随机 10 台真机安装运行无崩溃；数据导出→桌面导入 roundtrip

### T4 iOS
- 前置：Mac + Xcode + 开发者账号（$99/年）；WKWebView 文件选择够用一期
- 验收：TestFlight 分发；ICS 导出到系统日历（EventKit）评估

### T5 迁移红利（解冻后）
- ICS 写入系统日历（CalendarContract / EventKit）——移动端刚需
- 联网功能按第 2 节纪律进入：教务对接 → 可选云同步

## 4. 风险清单

| 风险 | 应对 |
|---|---|
| VS Build Tools 体积大（~7GB） | 仅装 VC.Tools.x86.x64 + Windows SDK 组件 |
| Android WebView 碎片 | Tauri 2 minSdk 24+；国产家族 WebView 自更新，风险低 |
| 华为无 GMS | Tauri 无 GMS 依赖，无影响 |
| 杀后台 | 纯本地无后台需求，天然免疫 |
| 双渠道回归成本 | core 单测 + 各 adapter 冒烟脚本（CDP 模式复用） |
| iOS 成本 | 放最后；无 Mac 则无限期推迟，不阻塞 Android |

## 5. 与现有代码的衔接

- `scripts/prepare-tauri.mjs` 已组装 dist/（app/ + core/ + adapters/ + branding.js）
- `src-tauri/` identifier 需同步 branding（现为旧值 com.campuser.wakeuplocal →
  应由 apply-branding.mjs 统一改写 tauri.conf.json）
- `start-apk.bat` 依赖本方案的环境变量（JAVA_HOME / ANDROID_HOME / NDK_HOME / PATH）
