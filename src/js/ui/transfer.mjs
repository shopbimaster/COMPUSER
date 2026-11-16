// campuser · transfer
import { currentSchedule, showToast, BRAND, Ports, $, session, W, Bk, Csv, Ics } from "./context.mjs";
import { openModal } from "./dialogs.mjs";
import { handleImportText } from "./imports.mjs";

// ---------- 分享与导入导出（文件 / QR / 口令，全离线） ----------
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${W.pad2(d.getMonth() + 1)}${W.pad2(d.getDate())}`;
}
function fileNameSafe(name) {
  return (
    String(name)
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 40) || "schedule"
  );
}

function toggleMenu(id) {
  const menu = $(id);
  const willOpen = menu.hidden;
  document.querySelectorAll(".dropdown").forEach((d) => {
    d.hidden = true;
  });
  menu.hidden = !willOpen;
}

async function doExportAction(act) {
  const sch = currentSchedule();
  const base = fileNameSafe(sch.name);
  let where = null;
  try {
    if (act === "share") {
      // 分享当前课表 → 选择分享方式（口令 / JSON / CSV / ICS）
      openModal("shareChoiceModal");
      return;
    }
    if (act === "backup-all") {
      where = await Ports.share.send(
        Bk.serialize(session.state),
        `${BRAND.EXPORT_PREFIX}-backup-${dateStamp()}.json`,
      );
    } else if (act === "share-json") {
      where = await Ports.share.send(
        Bk.serializeShare(sch),
        `${BRAND.EXPORT_PREFIX}-share-${base}.json`,
      );
    } else if (act === "share-csv") {
      where = await Ports.share.send(
        Csv.toCsv(sch),
        `${BRAND.EXPORT_PREFIX}-${base}-${dateStamp()}.csv`,
      );
    } else if (act === "share-ics") {
      where = await Ports.share.send(
        Ics.toIcs(sch),
        `${BRAND.EXPORT_PREFIX}-${base}-${dateStamp()}.ics`,
      );
    }
  } catch (e) {
    // 保存失败必须给出详细报错（与导入诊断同级），不静默吞掉
    showToast(`保存失败：${e?.message || String(e)}`, 8000);
    return;
  }
  if (!where) return;
  // Android 另存返回 content:// URI，展示为可读的文件名（解码末段）
  const whereText = where.startsWith("content://")
    ? `「${decodeURIComponent(where.split("/").pop() || "所选位置")}」`
    : where;
  showToast(`已保存到 ${whereText}`, 4000);
}

async function doImportAction(act) {
  try {
    const r = await Ports.share.receive();
    if (!r) return;
    if (r.error) throw new Error(r.detail || r.error || "无法读取文件");
    await handleImportText(r.text, r.name);
  } catch (error) {
    showToast("导入失败：" + (error?.message || String(error)), 8000);
  }
}

export { dateStamp, fileNameSafe, toggleMenu, doExportAction, doImportAction };
