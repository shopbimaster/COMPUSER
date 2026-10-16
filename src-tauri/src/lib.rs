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

// Android 状态栏图标颜色随应用主题：浅色页面 → 深色图标（APPEARANCE_LIGHT_STATUS_BARS），
// 深色页面 → 白色图标（清除该 appearance）。edge-to-edge 下状态栏背景透明，仅切前景。
// UI 调用必须主线程：run_on_main_thread + JNI（WindowInsetsController，API 30+；
// 更低版本静默无效——近年设备均满足）。
#[tauri::command]
fn set_status_bar_icons(app: tauri::AppHandle, light: bool) {
    #[cfg(target_os = "android")]
    {
        let r = app.run_on_main_thread(move || {
            use jni::objects::{JObject, JValue};
            // ndk-context 0.1：vm()/context() 返回 *mut c_void（无 Option 包装）。
            // 二者必须分别取用——此前误把 context 指针当 JavaVM 用（from_raw 解引用
            // 假 VM 指针）→ SIGSEGV，表现为应用打开约一秒后闪退。
            let ac = ndk_context::android_context();
            let (vm_ptr, ctx_ptr) = (ac.vm(), ac.context());
            if vm_ptr.is_null() || ctx_ptr.is_null() {
                return;
            }
            let vm = unsafe {
                match jni::JavaVM::from_raw(vm_ptr.cast()) {
                    Ok(v) => v,
                    Err(_) => return,
                }
            };
            let mut env = match vm.attach_current_thread() {
                Ok(e) => e,
                Err(_) => return,
            };
            let activity = unsafe { JObject::from_raw(ctx_ptr.cast()) };
            let Ok(window) = env
                .call_method(&activity, "getWindow", "()Landroid/view/Window;", &[])
                .and_then(|v| v.l())
            else {
                let _ = env.exception_clear(); // 清挂起异常，避免污染后续 JNI
                return;
            };
            // WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS = 0x08
            let Ok(controller) = env
                .call_method(&window, "getInsetsController", "()Landroid/view/WindowInsetsController;", &[])
                .and_then(|v| v.l())
            else {
                let _ = env.exception_clear();
                return;
            };
            if controller.is_null() {
                return;
            }
            let appearance: i32 = if light { 0x08 } else { 0 };
            if env
                .call_method(
                    &controller,
                    "setSystemBarsAppearance",
                    "(II)V",
                    &[JValue::Int(appearance), JValue::Int(0x08)],
                )
                .is_err()
            {
                let _ = env.exception_clear();
            }
        });
        if let Err(e) = r {
            eprintln!("set_status_bar_icons: {e}");
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, light);
    }
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

// Android：读 content:// URI。系统文件选择器（ACTION_GET_CONTENT）返回 content URI，
// std::fs 读不了 → JNI 走 ContentResolver.openInputStream 全量读为 UTF-8 文本。
#[tauri::command]
fn read_content_file(uri: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::{JByteArray, JObject, JValue};
        let ac = ndk_context::android_context();
        let (vm_ptr, ctx_ptr) = (ac.vm(), ac.context());
        if vm_ptr.is_null() || ctx_ptr.is_null() {
            return Err("no android context".into());
        }
        let vm = unsafe { jni::JavaVM::from_raw(vm_ptr.cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let activity = unsafe { JObject::from_raw(ctx_ptr.cast()) };

        // JNI 调用辅助：失败即清挂起异常并带步骤名报错（真机排障定位到具体环节）
        macro_rules! j {
            ($step:expr, $res:expr) => {
                match $res {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = env.exception_clear();
                        return Err(format!("JNI[{}]: {}", $step, e));
                    }
                }
            };
        }

        let resolver = j!(
            "getContentResolver",
            env.call_method(&activity, "getContentResolver", "()Landroid/content/ContentResolver;", &[])
                .and_then(|v| v.l())
        );
        let jstr = j!("new_string", env.new_string(&uri));
        // android.net.Uri 无公开构造函数，必须用静态方法 Uri.parse(String)
        let juri = j!(
            "Uri.parse",
            env.call_static_method(
                "android/net/Uri",
                "parse",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&jstr)]
            )
            .and_then(|v| v.l())
        );
        let stream = j!(
            "openInputStream",
            env.call_method(
                &resolver,
                "openInputStream",
                "(Landroid/net/Uri;)Ljava/io/InputStream;",
                &[JValue::Object(&juri)]
            )
            .and_then(|v| v.l())
        );
        if stream.is_null() {
            return Err("无法读取所选文件（provider 返回空流）".into());
        }

        // 优先 readAllBytes（API 33+），不可用回退循环 read
        let bytes: Vec<u8> = match env
            .call_method(&stream, "readAllBytes", "()[B", &[])
            .and_then(|v| v.l())
        {
            Ok(arr) => {
                let arr: JByteArray = arr.into();
                j!("readAllBytes 转换", env.convert_byte_array(&arr))
            }
            Err(e) => {
                let _ = env.exception_clear();
                let mut out: Vec<u8> = Vec::new();
                let buf = j!("new buf", env.new_byte_array(65536));
                loop {
                    let n = j!(
                        "read",
                        env.call_method(&stream, "read", "([B)I", &[JValue::Object(&buf)])
                            .and_then(|v| v.i())
                    );
                    if n <= 0 {
                        break;
                    }
                    let n = n as usize;
                    let seg = j!("read 转换", env.convert_byte_array(&buf));
                    out.extend_from_slice(&seg[..n]);
                }
                let _ = e;
                out
            }
        };
        let _ = env.call_method(&stream, "close", "()V", &[]);
        String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = uri;
        Err("仅 Android 支持 content URI".into())
    }
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
            set_status_bar_icons,
            read_content_file,
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
