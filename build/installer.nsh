; CAMPUSER · NSIS 自定义安装脚本
; 「选项页」：目录页之后询问 桌面快捷方式 + 开机自动启动（均默认勾选）
;
; 结构铁律（勿回退，历史多轮踩坑结论）：
; 1. customPageAfterChangeDir 展开点位于页面定义区（非 Section/Function），
;    宏体内只能放编译期指令（PageEx）。任何 ${NSD_*}/${If} 等"define 形式宏"
;    都会在 !macro 定义阶段被立即展开，其展开链在宏上下文中定义宏即报
;    "can't define a macro inside a macro"。UI 构建必须放进 PageCallbacks
;    指向的 Function（顶层编译，安全区）。
; 2. 卸载器构建（BUILD_UNINSTALLER define）会编译本文件：未被引用的
;    Function/Var 触发"警告即错误"，用 !ifndef 排除。
; 3. customInstall 在 Section 内展开：禁用 LogicLib（${If}），条件用原生
;    StrCmp + 相对跳转。品牌名直接写字面量（与 branding.js 同步，由
;    scripts/apply-branding.mjs 保证）。
; 4. /SD 默认值保证静默安装（/S）不被阻塞。

!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks nsOptionsPageCreate nsOptionsPageLeave
  PageExEnd
!macroend

; 函数与变量仅安装器引用；卸载器构建排除以免"未引用"警告
!ifndef BUILD_UNINSTALLER
Var DESKTOP_CB      ; 桌面快捷方式勾选框
Var DESKTOP_STATE   ; 勾选状态（1=勾选）
Var AUTOSTART_CB    ; 开机自启勾选框
Var AUTOSTART_STATE ; 勾选状态（1=勾选）

Function nsOptionsPageCreate
  ; 默认勾选：静默安装（/S）无 UI 直接沿用；GUI 向导由下方控件覆盖
  StrCpy $DESKTOP_STATE "1"
  StrCpy $AUTOSTART_STATE "1"
  IfSilent options_done
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0u 0u 100% 10u "选择附加任务"
  Pop $0
  ${NSD_CreateCheckbox} 0u 18u 100% 10u "创建桌面快捷方式"
  Pop $DESKTOP_CB
  ${NSD_SetState} $DESKTOP_CB 1
  ${NSD_CreateCheckbox} 0u 36u 100% 10u "开机自动启动 CAMPUSER"
  Pop $AUTOSTART_CB
  ${NSD_SetState} $AUTOSTART_CB 1
  nsDialogs::Show
  options_done:
FunctionEnd

; 控件状态必须在 leave 回调读取（官方 nsDialogs 模式）：
; Show 返回后对话框即销毁，在 create 函数尾部读取会得到 0
; ——这是 GUI 勾选"创建桌面快捷方式"不生效的根因（静默走默认值故正常）
Function nsOptionsPageLeave
  ${NSD_GetState} $DESKTOP_CB $DESKTOP_STATE
  ${NSD_GetState} $AUTOSTART_CB $AUTOSTART_STATE
FunctionEnd
!endif

!macro customInstall
  ; 静默安装（/S）会跳过选项页回调，state 为空时按默认勾选（两项都建）
  StrCmp $DESKTOP_STATE "" 0 +2
    StrCpy $DESKTOP_STATE "1"
  StrCmp $AUTOSTART_STATE "" 0 +2
    StrCpy $AUTOSTART_STATE "1"
  ; 桌面快捷方式（自建自管：electron-builder 侧已关闭自动创建）
  StrCmp $DESKTOP_STATE "1" 0 +2
    CreateShortCut "$DESKTOP\CAMPUSER.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
  ; 开机自动启动（HKCU 当前用户，无需管理员权限）
  StrCmp $AUTOSTART_STATE "1" 0 +2
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CAMPUSER" "$INSTDIR\${PRODUCT_NAME}.exe"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\CAMPUSER.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CAMPUSER"
!macroend
