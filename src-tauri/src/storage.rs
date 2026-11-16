// campuser · durable snapshots. Commands share a mutex so compare/backup/replace is one transaction.
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub static LOCK: Mutex<()> = Mutex::new(());
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct Snapshot { pub text: Option<String>, pub backup: Option<String> }

fn sibling(file: &Path, suffix: &str) -> PathBuf {
    let mut name = file.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn unique_suffix() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{}-{}-{}", std::process::id(), now, SEQUENCE.fetch_add(1, Ordering::Relaxed))
}

fn read(file: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(file) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取课表: {e}")),
    }
}

fn validate(text: &str) -> Result<(), String> {
    let raw: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if !raw.is_object() { return Err("课表数据不是有效对象".into()); }
    if !raw["format"].is_null() && raw["format"] != "campuser-schedule/2" {
        return Err("不支持的数据版本".into());
    }
    let valid = if let Some(schedules) = raw["schedules"].as_array() {
        !schedules.is_empty() && schedules.iter().all(|s| s.is_object() &&
            s["courses"].as_array().is_some_and(|courses| courses.iter().all(|c| c.is_object() &&
                c["timeSlots"].as_array().is_some_and(|slots| !slots.is_empty() && slots.iter().all(Value::is_object)))))
    } else {
        raw["format"].is_null() && raw["courses"].as_array().is_some_and(|courses| courses.iter().all(Value::is_object))
    };
    if valid { Ok(()) } else { Err("课表或课程时间段结构损坏".into()) }
}

fn atomic_write(file: &Path, text: &str) -> Result<(), String> {
    let temp = sibling(file, &format!(".{}.tmp", unique_suffix()));
    let result = (|| -> std::io::Result<()> {
        let mut output = OpenOptions::new().write(true).create_new(true).open(&temp)?;
        output.write_all(text.as_bytes())?;
        output.sync_all()?;
        drop(output);
        fs::rename(&temp, file)?;
        #[cfg(unix)]
        if let Some(parent) = file.parent() { fs::File::open(parent)?.sync_all()?; }
        Ok(())
    })();
    if temp.exists() { let _ = fs::remove_file(temp); }
    result.map_err(|e| format!("保存课表失败: {e}"))
}

pub fn load(file: &Path) -> Result<Snapshot, String> {
    Ok(Snapshot { text: read(file)?, backup: read(&sibling(file, ".bak"))? })
}

pub fn save(file: &Path, text: &str, expected: Option<&str>) -> Result<(), String> {
    validate(text)?;
    let previous = read(file)?;
    if previous.as_deref() != expected {
        return Err("数据已被其他窗口修改，请先导出当前修改，再重新加载".into());
    }
    if let Some(parent) = file.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let backup = sibling(file, ".bak");
    if let Some(old) = previous {
        if validate(&old).is_ok() { atomic_write(&backup, &old)?; }
        else { atomic_write(&sibling(file, &format!(".corrupt-{}", unique_suffix())), &old)?; }
    } else if read(&backup)?.is_none() { atomic_write(&backup, text)?; }
    atomic_write(file, text)
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIRST: &str = r#"{"courses":[],"settings":null}"#;
    const NEXT: &str = r#"{"format":"campuser-schedule/2","schedules":[{"courses":[]}]}"#;

    struct Temp(PathBuf);
    impl Temp { fn new() -> Self { Self(std::env::temp_dir().join(format!("campuser-test-{}", unique_suffix()))) } }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn replace_and_backup_preserve_previous_revision() {
        let dir = Temp::new(); let file = dir.0.join("schedule.json");
        assert!(load(&file).unwrap().text.is_none());
        save(&file, FIRST, None).unwrap();
        save(&file, NEXT, Some(FIRST)).unwrap();
        let snapshot = load(&file).unwrap();
        assert_eq!(snapshot.text.as_deref(), Some(NEXT));
        assert_eq!(snapshot.backup.as_deref(), Some(FIRST));
        assert!(save(&file, FIRST, Some(FIRST)).is_err());
        assert_eq!(load(&file).unwrap().text.as_deref(), Some(NEXT));
    }

    #[test]
    fn repair_archives_corruption_without_rotating_valid_backup() {
        let dir = Temp::new(); let file = dir.0.join("schedule.json");
        save(&file, FIRST, None).unwrap();
        fs::write(&file, "broken").unwrap();
        save(&file, FIRST, Some("broken")).unwrap();
        assert_eq!(load(&file).unwrap().backup.as_deref(), Some(FIRST));
        assert!(fs::read_dir(&dir.0).unwrap().any(|p| p.unwrap().file_name().to_string_lossy().contains(".corrupt-")));
        assert!(save(&file, "{}", Some(FIRST)).is_err());
        assert!(validate(r#"{"format":"campuser-schedule/3","schedules":[{"courses":[]}]}"#).is_err());
    }

    #[test]
    fn invalid_shapes_and_failed_replace_leave_primary_intact() {
        for raw in ["null", "[]", "{", r#"{"schedules":[]}"#, r#"{"schedules":[{}]}"#, r#"{"schedules":[{"courses":[null]}]}"#] {
            assert!(validate(raw).is_err(), "accepted {raw}");
        }
        let dir = Temp::new(); let file = dir.0.join("schedule.json");
        save(&file, FIRST, None).unwrap();
        fs::remove_file(sibling(&file, ".bak")).unwrap();
        fs::create_dir(sibling(&file, ".bak")).unwrap();
        assert!(save(&file, NEXT, Some(FIRST)).is_err());
        assert_eq!(read(&file).unwrap().as_deref(), Some(FIRST));
    }
}
