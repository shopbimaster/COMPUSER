// campuser · imports
import { currentSchedule, currentSettings, touchSchedule, showToast, escapeHtml, M, $, session, Mrg, Bk, Csv, Ics } from "./context.mjs";
import { calcCurrentWeek, render, updateWeekUI } from "./grid.mjs";
import { openModal, closeModal } from "./dialogs.mjs";
import { persist } from "./storage-ui.mjs";

async function handleImportText(text, name) {
  // CSV → 课程导入当前课表
  if (/\.csv$/i.test(name || "")) {
    const r = Csv.parseCsv(text);
    if (r.error) {
      showToast("导入失败：" + r.error);
      return;
    }
    const sch = currentSchedule();
    for (const c of r.courses) sch.courses.push(c);
    touchSchedule();
    if (!(await persist())) return;
    render();
    showToast(
      `已导入 ${r.courses.length} 门课程` +
        (r.skipped ? `（跳过 ${r.skipped} 行无效数据）` : ""),
    );
    return;
  }

  // ICS → 整表导入为新课表（扩展名或内容嗅探；携带自身学期设置）。
  // 有与节次时间表匹配的日程时先询问：匹配的存为课程格式（随时间表统一变更）或保留自定义时间
  if (/\.ics$/i.test(name || "") || /^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text)) {
    const first = Ics.parseIcs(text, name);
    if (first.error) {
      showToast("导入失败：" + first.error);
      return;
    }
    if (first.stats.matched > 0) {
      session.pendingIcsImport = { text, name };
      $("icsFormatSummary").innerHTML =
        `<b>${escapeHtml(first.schedule.name)}</b><br>` +
        `${first.schedule.courses.length} 门课程 / ${first.stats.total} 个时间段，` +
        `其中 <b>${first.stats.matched}</b> 个的时间与节次时间表完全匹配`;
      openModal("icsFormatModal");
      return;
    }
    importAsNewSchedules([first.schedule], true);
    return;
  }

  const parsed = Bk.parseAuto(text);
  if (parsed.error) {
    showToast("导入失败：" + parsed.error);
    return;
  }
  if (parsed.kind === "share") {
    importAsNewSchedules([parsed.schedule], true);
    return;
  }
  // 完整备份 → 选择导入方式
  const n = parsed.state.schedules.reduce((a, s) => a + s.courses.length, 0);
  $("importSummary").innerHTML =
    `<b>${escapeHtml(name || "备份文件")}</b><br>${parsed.state.schedules.length} 个课表 / ${n} 门课程`;
  session.pendingImportState = parsed.state;
  openModal("importChoiceModal");
}

// ---------- 导入时的设置统一询问 ----------
// 比较「外观 + 上课时间」白名单项（不含学期起止/周数等课表自身数据）
const SETTINGS_COMPARE_KEYS = [
  "alpha",
  "saturation",
  "courseTextSize",
  "cornerRadius",
  "courseGap",
  "textHCenter",
  "textVCenter",
  "showColBg",
  "colBgAlpha",
  "headerTextSize",
  "otherWeekAlpha",
  "showOtherWeek",
  "showSaturday",
  "showSunday",
  "sundayFirst",
  "showSchName",
  "showWeekTitle",
  "classNum",
  "sameLen",
];
function settingsDiffer(a, b) {
  for (const k of SETTINGS_COMPARE_KEYS) {
    if ((a[k] || 0) !== (b[k] || 0)) return true;
  }
  return JSON.stringify(a.times || []) !== JSON.stringify(b.times || []);
}

function importAsNewSchedules(list, askSettings = false) {
  const cur = currentSchedule().settings || {};
  // 单课表导入（口令/ICS/扫码）：文件设置与当前不同时询问是否一键沿用当前设置。
  // 备份导入是完整恢复语义，不询问。
  if (
    askSettings &&
    list.length === 1 &&
    settingsDiffer(list[0].settings || {}, cur)
  ) {
    session.pendingImportList = list;
    $("importSettingsText").innerHTML =
      `导入的课表「<b>${escapeHtml(list[0].name || "未命名")}</b>」与当前课表的` +
      `<b>外观或上课时间</b>设置存在差异。<br>是否沿用当前课表的设置（新导入的课表将一键统一）？`;
    openModal("importSettingsModal");
    return;
  }
  doImportAsNew(list);
}


async function doImportAsNew(list) {
  const existing = new Set(session.state.schedules.map((s) => s.name));
  let first = null;
  for (const raw of list) {
    const sch = M.normalizeSchedule(JSON.parse(JSON.stringify(raw)));
    sch.id = M.newId("sch");
    if (existing.has(sch.name)) sch.name += "(导入)";
    existing.add(sch.name);
    session.state.schedules.push(sch);
    if (!first) first = sch.id;
  }
  session.state.currentScheduleId = first;
  session.state.updatedAt = Date.now();
  session.viewWeek = Math.min(
    currentSettings().totalWeeks,
    Math.max(1, calcCurrentWeek()),
  );
  if (!(await persist())) return;
  updateWeekUI();
  render();
  showToast(`已导入 ${list.length} 个课表`);
}

// 沿用当前课表的外观/上课时间设置：白名单键 + 时间表深拷贝覆盖到导入课表
function applyCurrentSettingsTo(list) {
  const cur = currentSchedule().settings || {};
  for (const raw of list) {
    if (!raw.settings) raw.settings = {};
    for (const k of SETTINGS_COMPARE_KEYS) raw.settings[k] = cur[k];
    raw.settings.times = (cur.times || []).map((t) => ({ ...t }));
  }
}

async function confirmImportChoice() {
  if (!session.pendingImportState) return;
  const mode =
    (document.querySelector('input[name="importMode"]:checked') || {}).value ||
    "new";
  closeModal("importChoiceModal");
  const incoming = session.pendingImportState;
  session.pendingImportState = null;
  if (mode === "merge") {
    session.state = Mrg.mergeState(session.state, incoming);
    if (!(await persist())) return;
    updateWeekUI();
    render();
    showToast("合并导入完成（双方较新的修改均已保留）");
  } else {
    importAsNewSchedules(incoming.schedules);
  }
}

// 日历导入：匹配节次时间表的日程——存为课程格式（随时间表统一变更）或保留自定义时间
function confirmIcsFormat() {
  if (!session.pendingIcsImport) return;
  const mode =
    (document.querySelector('input[name="icsFormat"]:checked') || {}).value ||
    "course";
  const { text, name } = session.pendingIcsImport;
  session.pendingIcsImport = null;
  closeModal("icsFormatModal");
  const r = Ics.parseIcs(text, name, { courseFormat: mode === "course" });
  if (r.error) {
    showToast("导入失败：" + r.error);
    return;
  }
  importAsNewSchedules([r.schedule], true);
}

export { handleImportText, settingsDiffer, importAsNewSchedules, doImportAsNew, applyCurrentSettingsTo, confirmImportChoice, confirmIcsFormat, SETTINGS_COMPARE_KEYS };
