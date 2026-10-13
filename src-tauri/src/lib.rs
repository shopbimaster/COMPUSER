// CAMPUSER · Tauri 2 壳
// 壳只做平台能力（存储/文件/分享）；领域逻辑在 core/（JS UMD）。
// 与 Electron 版数据契约一致：app_data_dir/schedule.json（campuser-schedule/2）。

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    Ok(dir.join("schedule.json"))
}

fn sanitize_name(name: &str) -> String {
    let n = name.trim().replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    if n.is_empty() || n == "." || n == ".." {
        "campuser-export.txt".to_string()
    } else {
        n
    }
}

#[tauri::command]
fn os_platform() -> &'static str {
    std::env::consts::OS
}

// ---- 存储：与 Electron 版同格式（schedule.json 文本） ----

#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = data_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    fs::read_to_string(file).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let file = data_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(file, text).map_err(|e| e.to_string())
}

// ---- 文件：导出落盘 / 读取所选文件 / 临时文件（供分享） ----

#[tauri::command]
fn write_file(path: String, text: String) -> Result<(), String> {
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_temp_file(app: tauri::AppHandle, name: String, text: String) -> Result<String, String> {
    let dir = app
        .path()
        .cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("exports");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(sanitize_name(&name));
    fs::write(&file, text).map_err(|e| e.to_string())?;
    file.to_str().map(|s| s.to_string()).ok_or_else(|| "path not utf-8".into())
}

// Android 系统分享面板：tauri-plugin-share 的 IPC 层未发布（命令被注释），
// 这里直接经 Rust 侧 ShareExt 驱动其 Kotlin 实现
#[tauri::command]
async fn share_file_android(app: tauri::AppHandle, path: String, mime: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_share::ShareExt;
        app.share_file()
            .share_file(tauri_plugin_share::ShareRequest { path: Some(path), mime, group: None })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path, mime);
        Err("仅 Android 支持分享面板".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_share::init())
        .invoke_handler(tauri::generate_handler![
            os_platform,
            load_data,
            save_data,
            write_file,
            read_text_file,
            write_temp_file,
            share_file_android
        ])
        .run(tauri::generate_context!())
        .expect("error while running CAMPUSER");
}
