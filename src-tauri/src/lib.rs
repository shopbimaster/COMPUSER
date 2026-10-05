// WakeUp 课程表 本地版 · Tauri 2 壳
// 壳只做窗口与系统层；领域逻辑在 core/（JS），存储经 WebView localStorage，
// 与浏览器/桌面版数据契约一致（wakeup-schedule-data）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running WakeUp Schedule local");
}
