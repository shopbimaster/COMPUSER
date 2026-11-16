# campuser 跨平台实现与迁移状态

更新：2026-11-17。本文描述当前代码，不将旧计划视为已验收功能。

## 当前实现

- Electron 桌面壳继续维护；Tauri 2 已有 Android 工程和平台端口；iOS 尚未提供工程。
- 平台共享 `core/` 与 `src/js/`。UI 已改为显式依赖的 ES 模块，入口为 `app.mjs`；领域规则与编解码仍为可在 Node 和 WebView 中复用的模块。
- 存储协议为 `campuser-schedule/2`，应用 ID 为 `com.campuser.app`。所有显示名称取自 `branding.js`，统一为小写 campuser。
- Android 导入走系统文件选择器与 ContentResolver；导出走系统另存为与 ContentResolver。适配器先等待平台识别完成，再选择正确实现。
- Electron 与 Tauri 采用临时文件同步后替换主文件、保留上一版备份、损坏原文归档；浏览器采用 localStorage 双键备份。统一端口约定见下文。
- Android 主清单不声明 INTERNET；debug 清单允许开发服务器连接；release 清单通过 manifest merger 明确移除依赖可能引入的 INTERNET 权限。

## 存储端口契约

```js
storage.load() // Promise<{ text: string | null, backup: string | null }>
storage.save(text, { expected }) // Promise；失败必须 reject，禁止吞错
```

`null` 仅表示文件/存储键确实不存在。权限、读取和配额错误必须抛出。`expected` 是加载时或上次成功保存时的主文件原文，写入前比较以阻止陈旧窗口覆盖。

`core/persistence.js` 选择有效数据并执行迁移。恢复前后保留原文；无法识别的数据版本禁止自动降级。保存调用捕获不可变 JSON 快照并顺序执行。UI 只有收到成功结果才报告完成，失败可重试或导出内存修改。

## 验收与边界

1. `npm test`：领域逻辑、故障注入、旧格式兼容、模块及 DOM 交互。
2. `npm run prepare-tauri && npm run test:smoke`：源码与组装资源在实际 Chromium 中加载，检查桌面和窄屏、课程新增、切周、设置与控制台。
3. `cargo test --manifest-path src-tauri/Cargo.toml --lib`：原生文件事务及备份测试。
4. Android 发布前必须检查 **merged manifest / APK 最终权限**，不能仅凭源清单判断；还须真机检验文件互通、升级和故障恢复。
5. iOS 需要 Mac、Xcode 与相应分发条件；没有实现和验收前不宣称支持。

后续平台功能继续采用“先定义端口，再逐端实现”的方式。纯本地 release 不加入网络权限；如未来引入联网能力，应独立定义发行方式与用户选择。
