// campuser · context


// ============================================================
// campuser · UI 层（v2）
// 仅负责渲染与交互：领域逻辑在 core/（model/week/conflict/merge/codec），
// 平台能力经 Ports 端口注入（adapters/）。数据格式 campuser-schedule/2。
// 软件名统一取自 branding.js（window.CAMPUSER_BRAND），不得硬编码。
// ============================================================

// ---------- 常量 ----------
const BRAND = window.CAMPUSER_BRAND;
document.title = BRAND.FULL_NAME;
const COURSE_COLORS = [
  "#e8935a",
  "#9b7fd4",
  "#e088ac",
  "#5fa284",
  "#6c9bd9",
  "#d8739e",
  "#5a83be",
  "#4db6ac",
  "#ef9a5c",
  "#4a7fc1",
];
const DAY_NAMES = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};
// 周表头单字显示（去掉「周」字的中文数字，对齐移动端紧凑表头）
const DAY_ABBR = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "日",
};
const ODD_NAMES = ["每周", "单周", "双周"];

// 线条描边图标（随文字颜色）
const svgIco = (paths, w = 15) =>
  `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
  calendar: svgIco(
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  ),
  clock: svgIco('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  room: svgIco(
    '<path d="M12 21s-6.5-5.3-6.5-10a6.5 6.5 0 1 1 13 0C18.5 15.7 12 21 12 21z"/><circle cx="12" cy="10.8" r="2.2"/>',
  ),
  teacher: svgIco(
    '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.9-3.5 3.5-5.3 6.5-5.3s5.6 1.8 6.5 5.3"/>',
  ),
  note: svgIco(
    '<path d="M5 4h9.5L19 8.5V20H5z"/><path d="M14 4v5h5"/><path d="M8.5 13h7M8.5 16.5h4.5"/>',
  ),
  trash: svgIco(
    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  ),
};

// ---------- 内核与端口 ----------
const M = CampuserModel,
  W = CampuserWeek,
  C = CampuserConflict,
  Mrg = CampuserMerge,
  Bk = CampuserBackupCodec;
const Adj = window.CampuserAdjust; // 调课数据变换
const Share = CampuserShareCodec,
  Csv = CampuserCsvCodec,
  Ics = CampuserIcsCodec;
const {
  parseDate,
  fmtDate,
  addDays,
  mondayIndex,
  toMinutes: toMin,
  addMinutes,
} = W;
const Ports = window.__ports;

// ---------- 状态 ----------

// ---------- 小工具 ----------
const $ = (id) => document.getElementById(id);

function currentSchedule() {
  return (
    session.state.schedules.find((s) => s.id === session.state.currentScheduleId) ||
    session.state.schedules[0]
  );
}
function currentSettings() {
  return currentSchedule().settings;
}
function findCourse(id) {
  return currentSchedule().courses.find((c) => c.id === id) || null;
}
function touchSchedule() {
  currentSchedule().updatedAt = Date.now();
  session.state.updatedAt = Date.now();
}

function showToast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    t.hidden = true;
  }, ms);
}


function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}

const session = {
  pendingImportState: null,
  pendingIcsImport: null,
  gapPx: 4,
  state: null,
  viewWeek: 1,
  courseModalMode: "view",
  editingCourseId: null,
  editingSlotId: null,
  pickedColor: -1,
  tapSel: null,
  suppressClick: null,
  wdCtx: null,
  wdDrag: null,
  tpCtx: null,
  pendingAdjust: null,
  adjustDayFrom: null,
  pendingImportList: null,
};

export { currentSchedule, currentSettings, findCourse, touchSchedule, showToast, escapeHtml, BRAND, COURSE_COLORS, DAY_NAMES, DAY_ABBR, ODD_NAMES, svgIco, ICONS, M, Adj, Share, Ports, $, session, W, C, Mrg, Bk, Csv, Ics, parseDate, fmtDate, addDays, mondayIndex, toMin, addMinutes };
