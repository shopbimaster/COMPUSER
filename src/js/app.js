// ============================================================
// WakeUp 课程表 · 本地还原版
// 功能与数据模型还原自 YZune/WakeUpSchedule 开源版（2017-2018）
// - 课程字段: name/room/teach/day/start/step/startWeek/endWeek/isOdd/color
// - isOdd: 0每周 1单周 2双周；颜色: 10 色按课程名首字取模或手动指定
// - 本地运行，无广告，无网络请求，数据保存为本地 JSON
// ============================================================

// ---------- 常量 ----------
const COURSE_COLORS = ['#8af28d', '#00ff9d', '#ff6200', '#e7554e', '#4695ff', '#ca71ff', '#3daff1', '#5d5dff', '#80deea', '#2f88ff'];
const DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
const GAP = 4; // 节次间距（对应原版 marTop）

const DEFAULT_TIMES = [
  ['08:00', '08:50'], ['09:00', '09:50'], ['10:10', '11:00'], ['11:10', '12:00'],
  ['13:30', '14:20'], ['14:30', '15:20'], ['15:40', '16:30'], ['16:40', '17:30'],
  ['18:30', '19:20'], ['19:30', '20:20'], ['20:30', '21:20'], ['21:30', '22:20'],
  ['22:30', '23:20'], ['23:30', '00:20'], ['00:30', '01:20'], ['01:30', '02:20']
];

const DEFAULT_SETTINGS = {
  termStart: null,        // 学期开始日期 YYYY-MM-DD（首次运行默认本周一）
  totalWeeks: 20,         // 学期周数
  classNum: 11,           // 一天课程节数
  itemHeight: 56,         // 课程块单节高度 px（原版默认 56dp）
  alpha: 64,              // 颜色透明度 %（原版默认 64）
  showOtherWeek: true,    // 显示非本周课程（灰色）
  sundayFirst: false,     // 周日为第一天
  theme: 'light',         // light / dark
  sameLen: false,         // 每节课时长相同
  times: null             // [{start,end}] 节次时间表
};

// ---------- 状态 ----------
let state = {
  courses: [],
  settings: { ...DEFAULT_SETTINGS },
  viewWeek: 1
};
let courseModalMode = 'view'; // view | edit | add
let editingCourseId = null;

// ---------- 工具 ----------
const $ = (id) => document.getElementById(id);

// 领域内核别名：周次/日期/冲突纯函数已抽取至 core/，此处仅薄封装
const { parseDate, fmtDate, addDays, mondayIndex, toMinutes: toMin, addMinutes } = WakeupWeek;
const { slotInWeek: courseInWeek } = WakeupConflict;

// 端口：由适配器桥注入（Electron 桥优先，浏览器桥降级），UI 不再感知平台
const Ports = window.__ports;

function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function persist() {
  await Ports.storage.save(JSON.stringify({ courses: state.courses, settings: state.settings }));
}

// ---------- 周计算（还原原版 countWeek：天数差/7+1，实现在 core/week.js） ----------
function calcCurrentWeek() { return WakeupWeek.calcCurrentWeek(state.settings.termStart); }
function weekStartDate(w) { return WakeupWeek.weekStartDate(state.settings.termStart, w); }
function dayDate(w, day) { return WakeupWeek.dayDate(state.settings.termStart, w, day); }

function effectiveColorIndex(c) {
  if (typeof c.color === 'number' && c.color >= 0 && c.color <= 9) return c.color;
  if (typeof c.color === 'string' && c.color !== '' && !isNaN(Number(c.color))) return Number(c.color) % 10;
  // 原版逻辑：课程名首字符 % 10
  const code = c.name ? c.name.charCodeAt(0) : NaN;
  return isNaN(code) ? 9 : code % 10;
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
// 计算课程块样式：半透明颜色叠在卡片底色上，文字颜色按混合亮度自动取黑/白
function courseBlockStyle(c) {
  const color = COURSE_COLORS[effectiveColorIndex(c)];
  const [r, g, b] = hexToRgb(color);
  const card = state.settings.theme === 'dark' ? [42, 47, 52] : [255, 255, 255];
  const a = state.settings.alpha / 100;
  // 课程的最终视觉颜色 = 课程色按透明度混合卡片底色（用于判断文字对比度）
  const blend = [r, g, b].map((ch, i) => Math.round(ch * a + card[i] * (1 - a)));
  const lum = 0.299 * blend[0] + 0.587 * blend[1] + 0.114 * blend[2];
  return {
    bg: `rgba(${r}, ${g}, ${b}, ${a})`,
    text: lum > 165 ? '#20242a' : '#ffffff'
  };
}

function normalizeCourse(raw) {
  return {
    id: raw.id != null ? raw.id : 'c' + Date.now() + Math.random().toString(36).slice(2, 7),
    name: String(raw.name || '').trim(),
    room: String(raw.room || '').trim(),
    teach: String(raw.teach || '').trim(),
    day: Math.min(7, Math.max(1, Number(raw.day) || 1)),
    start: Math.max(1, Number(raw.start) || 1),
    step: Math.max(1, Number(raw.step) || 1),
    startWeek: Math.max(1, Number(raw.startWeek) || 1),
    endWeek: Math.max(1, Number(raw.endWeek) || 1),
    isOdd: [0, 1, 2].includes(Number(raw.isOdd)) ? Number(raw.isOdd) : 0,
    color: (raw.color === undefined || raw.color === null || raw.color === '' || raw.color < 0) ? -1 : Number(raw.color)
  };
}

function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const n = Math.min(16, Math.max(8, Number(s.classNum) || 11));
  s.classNum = n;
  s.totalWeeks = Math.min(40, Math.max(1, Number(s.totalWeeks) || 20));
  s.itemHeight = Math.min(90, Math.max(40, Number(s.itemHeight) || 56));
  s.alpha = Math.min(100, Math.max(10, Number(s.alpha) || 64));
  if (!s.termStart) {
    const now = new Date();
    s.termStart = fmtDate(addDays(now, -mondayIndex(now)));
  }
  if (!Array.isArray(s.times)) s.times = [];
  for (let i = 0; i < n; i++) {
    if (!s.times[i]) s.times[i] = { start: DEFAULT_TIMES[i][0], end: DEFAULT_TIMES[i][1] };
  }
  s.times = s.times.slice(0, n);
  return s;
}

// ---------- 渲染 ----------
function dayOrder() {
  return state.settings.sundayFirst ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
}

function render() {
  const { settings } = state;
  const todayStr = fmtDate(new Date());
  const days = dayOrder();
  // 原版行为：周日列无任何课程时隐藏（仅当周日排最后）
  const hasSundayCourse = state.courses.some(c => c.day === 7);
  const visibleDays = (!settings.sundayFirst && !hasSundayCourse) ? days.filter(d => d !== 7) : days;

  const grid = $('grid');
  grid.style.setProperty('--day-count', visibleDays.length);
  grid.style.setProperty('--unit', settings.itemHeight + 'px');
  grid.innerHTML = '';

  // 表头：角标 + 星期
  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  corner.textContent = '节次';
  grid.appendChild(corner);

  for (const d of visibleDays) {
    const date = dayDate(state.viewWeek, d);
    const h = document.createElement('div');
    h.className = 'day-header' + (fmtDate(date) === todayStr ? ' is-today' : '');
    h.innerHTML = `<span class="day-name">${DAY_NAMES[d]}</span><span class="day-date">${date.getMonth() + 1}/${date.getDate()}</span>`;
    grid.appendChild(h);
  }

  // 左侧节次列
  const timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (let i = 1; i <= settings.classNum; i++) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    sec.style.top = ((i - 1) * (settings.itemHeight + GAP) + GAP) + 'px';
    sec.innerHTML = `<span class="sec-no">${i}</span><span class="sec-time">${settings.times[i - 1].start}</span>`;
    timeCol.appendChild(sec);
  }
  grid.appendChild(timeCol);

  // 课程列
  for (const d of visibleDays) {
    const col = document.createElement('div');
    col.className = 'day-col';
    col.dataset.day = d;

    const dayCourses = state.courses
      .filter(c => c.day === d)
      .sort((a, b) => a.start - b.start || a.startWeek - b.startWeek);

    for (const c of dayCourses) {
      const inWeek = courseInWeek(c, state.viewWeek);
      if (!inWeek && !settings.showOtherWeek) continue;
      col.appendChild(buildCourseBlock(c, inWeek));
    }

    col.addEventListener('dblclick', (e) => {
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top - GAP;
      const sec = Math.max(1, Math.min(settings.classNum, Math.floor(y / (settings.itemHeight + GAP)) + 1));
      openCourseModal('add', null, { day: d, start: sec });
    });

    grid.appendChild(col);
  }

  // 空状态
  $('emptyTip').hidden = state.courses.length !== 0;
  renderWeekLabel();
}

function buildCourseBlock(c, isCurrent) {
  const { settings } = state;
  const el = document.createElement('div');
  el.className = 'course-block' + (isCurrent ? '' : ' other-week');
  const top = (c.start - 1) * (settings.itemHeight + GAP) + GAP;
  const height = c.step * settings.itemHeight + (c.step - 1) * GAP;
  el.style.top = top + 'px';
  el.style.height = height + 'px';

  const style = courseBlockStyle(c);
  el.style.background = style.bg;
  el.style.color = style.text;

  let html = `<div class="course-name">${escapeHtml(c.name)}</div>`;
  if (c.room) html += `<div class="course-room">@${escapeHtml(c.room)}</div>`;
  if (c.isOdd === 1) html += `<div class="course-tag">单周</div>`;
  if (c.isOdd === 2) html += `<div class="course-tag">双周</div>`;
  el.innerHTML = html;

  el.title = `${c.name} ${c.room ? '@' + c.room : ''} ${c.teach ? c.teach + ' 老师' : ''}`.trim();
  el.addEventListener('click', () => openCourseModal('view', c));
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderWeekLabel() {
  const cur = calcCurrentWeek();
  const label = $('weekLabel');
  label.textContent = `第 ${state.viewWeek} 周`;
  label.classList.toggle('is-current', state.viewWeek === cur);
}

function renderTodayInfo() {
  const now = new Date();
  const wd = DAY_NAMES[now.getDay() === 0 ? 7 : now.getDay()];
  const cur = calcCurrentWeek();
  let weekTxt = `第 ${cur} 周`;
  if (cur < 1) weekTxt = '未开学';
  if (cur > state.settings.totalWeeks) weekTxt = '学期已结束';
  $('todayInfo').textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${wd} · ${weekTxt}`;
}

function buildWeekSelect() {
  const sel = $('weekSelect');
  sel.innerHTML = '';
  for (let w = 1; w <= state.settings.totalWeeks; w++) {
    const o = document.createElement('option');
    o.value = w;
    o.textContent = `第${w}周`;
    sel.appendChild(o);
  }
  sel.value = state.viewWeek;
}

function setViewWeek(w) {
  state.viewWeek = Math.min(state.settings.totalWeeks, Math.max(1, w));
  $('weekSelect').value = state.viewWeek;
  render();
}

// ---------- 课程弹窗（详情 / 编辑 / 添加） ----------
function openCourseModal(mode, course, preset = {}) {
  courseModalMode = mode;
  editingCourseId = course ? course.id : null;

  $('courseModalTitle').textContent = mode === 'add' ? '添加课程' : (mode === 'edit' ? '修改课程' : '课程详情');
  $('btnEditCourse').textContent = mode === 'edit' ? '保存修改' : (mode === 'add' ? '添加' : '修改');
  $('btnDeleteCourse').hidden = mode === 'add';
  $('btnDeleteCourse').textContent = '删除';
  $('btnDeleteCourse').classList.remove('confirm');
  deleteArmed = false;
  $('formTip').textContent = '';

  const c = course || normalizeCourse({
    name: '', room: '', teach: '',
    day: preset.day || 1,
    start: preset.start || 1, step: 1,
    startWeek: 1, endWeek: state.settings.totalWeeks,
    isOdd: 0, color: -1
  });

  // 详情视图
  if (mode === 'view') {
    $('courseDetail').hidden = false;
    $('courseForm').hidden = true;
    renderCourseDetail(c);
  } else {
    $('courseDetail').hidden = true;
    $('courseForm').hidden = false;
    fillCourseForm(c);
  }
  openModal('courseModal');
}

function renderCourseDetail(c) {
  const s = state.settings;
  const endSec = c.start + c.step - 1;
  const oddTxt = ['每周', '单周', '双周'][c.isOdd];
  const t1 = s.times[Math.min(c.start, s.classNum) - 1] || { start: '--:--', end: '--:--' };
  const t2 = s.times[Math.min(endSec, s.classNum) - 1] || { start: '--:--', end: '--:--' };
  const color = COURSE_COLORS[effectiveColorIndex(c)];
  $('courseDetail').innerHTML = `
    <div class="detail-title">
      <span class="detail-color" style="background:${color}"></span>
      <span class="detail-name">${escapeHtml(c.name)}</span>
    </div>
    <div class="detail-grid">
      <span class="k">教师</span><span>${escapeHtml(c.teach || '—')}</span>
      <span class="k">教室</span><span>${escapeHtml(c.room || '—')}</span>
      <span class="k">时间</span><span>${DAY_NAMES[c.day]} 第${c.start}~${endSec}节</span>
      <span class="k">周次</span><span>第${c.startWeek}~${c.endWeek}周 · ${oddTxt}</span>
    </div>
    <div class="detail-time">🕐 ${t1.start} ~ ${t2.end}${c.step > 1 ? `（第${c.start}节 ${t1.start} 上课，第${endSec}节 ${t2.end} 下课）` : ''}</div>
  `;
}

function fillCourseForm(c) {
  const s = state.settings;
  $('f_name').value = c.name;
  $('f_teach').value = c.teach;
  $('f_room').value = c.room;
  $('f_day').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}">${DAY_NAMES[d]}</option>`).join('');
  $('f_day').value = c.day;
  $('f_odd').value = c.isOdd;
  let opts = '';
  for (let i = 1; i <= s.classNum; i++) {
    opts += `<option value="${i}">第${i}节 ${s.times[i - 1].start}</option>`;
  }
  $('f_start').innerHTML = opts;
  $('f_end').innerHTML = opts;
  $('f_start').value = Math.min(c.start, s.classNum);
  $('f_end').value = Math.min(c.start + c.step - 1, s.classNum);
  $('f_startWeek').value = c.startWeek;
  $('f_endWeek').value = Math.max(c.endWeek, c.startWeek);
  $('f_startWeek').max = s.totalWeeks;
  $('f_endWeek').max = s.totalWeeks;
  buildColorPick(typeof c.color === 'number' ? c.color : -1);
}

let pickedColor = -1;
function buildColorPick(selected) {
  pickedColor = selected;
  const box = $('colorPick');
  box.innerHTML = '';
  const auto = document.createElement('div');
  auto.className = 'color-swatch auto' + (selected === -1 ? ' selected' : '');
  auto.title = '自动（按课程名分配）';
  auto.textContent = 'A';
  auto.onclick = () => buildColorPick(-1);
  box.appendChild(auto);
  COURSE_COLORS.forEach((hex, i) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (selected === i ? ' selected' : '');
    sw.style.background = hex;
    sw.title = `颜色 ${i + 1}`;
    sw.onclick = () => buildColorPick(i);
    box.appendChild(sw);
  });
}

function readCourseForm() {
  const start = Number($('f_start').value);
  const end = Number($('f_end').value);
  const startWeek = Number($('f_startWeek').value);
  const endWeek = Number($('f_endWeek').value);
  const name = $('f_name').value.trim();
  if (!name) return { err: '请填写课程名' };
  if (!start || !end || start > end) return { err: '节次不合法：结束节次需不小于开始节次' };
  if (!startWeek || !endWeek || startWeek > endWeek) return { err: '周次不合法：结束周需不小于开始周' };
  return {
    course: normalizeCourse({
      id: editingCourseId,
      name,
      teach: $('f_teach').value.trim(),
      room: $('f_room').value.trim(),
      day: Number($('f_day').value),
      start, step: end - start + 1,
      startWeek, endWeek,
      isOdd: Number($('f_odd').value),
      color: pickedColor
    })
  };
}

// 冲突检测（软提示，实现在 core/conflict.js）
function findConflict(c) {
  return state.courses.find(o => o.id !== c.id && WakeupConflict.slotsConflict(o, c));
}

function saveCourseFromForm() {
  const r = readCourseForm();
  if (r.err) { $('formTip').textContent = r.err; return; }
  const c = r.course;
  const conflict = findConflict(c);
  if (conflict && !confirm(`与课程「${conflict.name}」时间冲突，仍要保存吗？`)) return;

  if (courseModalMode === 'edit') {
    const i = state.courses.findIndex(x => x.id === editingCourseId);
    if (i >= 0) state.courses[i] = c;
  } else {
    state.courses.push(c);
  }
  persist();
  closeModal('courseModal');
  render();
  toast(courseModalMode === 'edit' ? '修改成功' : '添加成功');
}

// 双击确认删除（还原原版"再点一次确认删除"）
let deleteArmed = false;
function onDeleteClick() {
  if (!deleteArmed) {
    deleteArmed = true;
    const btn = $('btnDeleteCourse');
    btn.textContent = '再点一次确认删除';
    btn.classList.add('confirm');
    setTimeout(() => {
      deleteArmed = false;
      btn.textContent = '删除';
      btn.classList.remove('confirm');
    }, 3000);
    return;
  }
  state.courses = state.courses.filter(c => c.id !== editingCourseId);
  persist();
  closeModal('courseModal');
  render();
  toast('删除成功');
}

// ---------- 弹窗开关 ----------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

// ---------- 设置 ----------
function openSettings() {
  const s = state.settings;
  $('s_termStart').value = s.termStart;
  $('s_totalWeeks').value = s.totalWeeks;
  const cnSel = $('s_classNum');
  cnSel.innerHTML = '';
  for (let i = 8; i <= 16; i++) cnSel.innerHTML += `<option value="${i}">${i} 节</option>`;
  cnSel.value = s.classNum;
  $('s_alpha').value = s.alpha;
  $('alphaVal').textContent = s.alpha + '%';
  $('s_itemHeight').value = s.itemHeight;
  $('heightVal').textContent = s.itemHeight + 'px';
  $('s_theme').value = s.theme;
  $('s_showOtherWeek').checked = s.showOtherWeek;
  $('s_sundayFirst').checked = s.sundayFirst;
  $('s_sameLen').checked = s.sameLen;
  $('sameLenEdit').hidden = !s.sameLen;
  const [sh, sm] = s.times[0].start.split(':').map(Number);
  const [eh, em] = s.times[0].end.split(':').map(Number);
  $('s_lessonLen').value = (eh * 60 + em) - (sh * 60 + sm);
  buildTimeTable();
  openModal('settingsModal');
}

function buildTimeTable() {
  const s = state.settings;
  const box = $('timeTable');
  box.innerHTML = '';
  for (let i = 0; i < s.classNum; i++) {
    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `
      <span class="t-no">${i + 1}</span>
      <input type="time" value="${s.times[i].start}" data-ti="${i}" data-field="start">
      <span class="t-sep">~</span>
      <input type="time" value="${s.times[i].end}" data-ti="${i}" data-field="end" ${s.sameLen ? 'disabled' : ''}>
    `;
    box.appendChild(row);
  }
}

function collectSettings() {
  const s = { ...state.settings };
  s.termStart = $('s_termStart').value || s.termStart;
  s.totalWeeks = Math.min(40, Math.max(1, Number($('s_totalWeeks').value) || 20));
  const newClassNum = Number($('s_classNum').value);
  s.alpha = Number($('s_alpha').value);
  s.itemHeight = Number($('s_itemHeight').value);
  s.theme = $('s_theme').value;
  s.showOtherWeek = $('s_showOtherWeek').checked;
  s.sundayFirst = $('s_sundayFirst').checked;
  s.sameLen = $('s_sameLen').checked;

  // 时间表
  s.times = state.settings.times.map(t => ({ ...t }));
  document.querySelectorAll('#timeTable input[data-ti]').forEach(inp => {
    const i = Number(inp.dataset.ti);
    if (inp.value) s.times[i][inp.dataset.field] = inp.value;
  });
  while (s.times.length < newClassNum) {
    const i = s.times.length;
    s.times.push({ start: DEFAULT_TIMES[i][0], end: DEFAULT_TIMES[i][1] });
  }
  s.times = s.times.slice(0, newClassNum);
  s.classNum = newClassNum;

  if (s.sameLen) {
    const len = Number($('s_lessonLen').value) || 45;
    s.times.forEach(t => { t.end = addMinutes(t.start, len); });
  }
  return s;
}

// addMinutes 由 core/week.js 提供（别名引入）

function saveSettings() {
  const s = collectSettings();
  const oldTermStart = state.settings.termStart;
  state.settings = normalizeSettings(s);
  state.viewWeek = Math.min(state.settings.totalWeeks, Math.max(1, state.viewWeek));
  if (oldTermStart !== state.settings.termStart) {
    state.viewWeek = Math.min(state.settings.totalWeeks, Math.max(1, calcCurrentWeek()));
  }
  document.documentElement.dataset.theme = state.settings.theme;
  persist();
  buildWeekSelect();
  render();
  renderTodayInfo();
  closeModal('settingsModal');
  toast('设置已保存');
}

// ---------- 今日课程 ----------
function openTodayModal() {
  const now = new Date();
  const todayDay = now.getDay() === 0 ? 7 : now.getDay();
  const curWeek = calcCurrentWeek();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  $('todayModalTitle').textContent = `今日课程 · ${now.getMonth() + 1}月${now.getDate()}日 ${DAY_NAMES[todayDay]}`;

  const list = state.courses
    .filter(c => c.day === todayDay && courseInWeek(c, curWeek))
    .sort((a, b) => a.start - b.start);

  const box = $('todayList');
  if (!list.length) {
    box.innerHTML = `<div class="today-empty">今天没有课，好好休息吧 ~</div>`;
  } else {
    box.innerHTML = '';
    for (const c of list) {
      const t1 = state.settings.times[Math.min(c.start, state.settings.classNum) - 1] || { start: '--:--', end: '--:--' };
      const t2 = state.settings.times[Math.min(c.start + c.step - 1, state.settings.classNum) - 1] || { start: '--:--', end: '--:--' };
      const [s1, s2] = [toMin(t1.start), toMin(t2.end)];
      const isPast = nowMin > s2;
      const isNow = nowMin >= s1 && nowMin <= s2;
      const item = document.createElement('div');
      item.className = `today-item${isPast ? ' past' : ''}${isNow ? ' current' : ''}`;
      item.innerHTML = `
        <span class="t-time">${t1.start}<br>${t2.end}</span>
        <div>
          <div class="t-name">${escapeHtml(c.name)}</div>
          <div class="t-sub">${escapeHtml([c.room, c.teach && c.teach + ' 老师'].filter(Boolean).join(' · ') || '—')}</div>
        </div>
        <span class="t-state${isNow ? ' now' : ''}">${isNow ? '● 进行中' : (isPast ? '已结束' : '未开始')}</span>
      `;
      box.appendChild(item);
    }
  }
  openModal('todayModal');
}
// toMin 由 core/week.js 提供（toMinutes 别名）

// ---------- 导入 / 导出（经分享端口：文件即传输介质） ----------
async function doImport() {
  const r = await Ports.share.receive();
  if (!r) return;
  if (r.error) { toast('导入失败：无法读取文件'); return; }
  let data;
  try { data = JSON.parse(r.text); } catch (e) { toast('导入失败：文件不是有效的 JSON'); return; }
  if (!data || !Array.isArray(data.courses)) {
    toast('导入失败：缺少 courses 字段');
    return;
  }
  if (!confirm(`将导入 ${data.courses.length} 门课程并覆盖当前数据，继续吗？`)) return;
  state.courses = data.courses.map(normalizeCourse);
  if (data.settings) state.settings = normalizeSettings(data.settings);
  document.documentElement.dataset.theme = state.settings.theme;
  state.viewWeek = Math.min(state.settings.totalWeeks, Math.max(1, calcCurrentWeek()));
  await persist();
  buildWeekSelect();
  render();
  renderTodayInfo();
  toast(`导入成功：${state.courses.length} 门课程`);
}

async function doExport() {
  const payload = {
    app: 'wakeup-schedule-local',
    version: 1,
    exportedAt: new Date().toISOString(),
    courses: state.courses,
    settings: state.settings
  };
  const where = await Ports.share.send(JSON.stringify(payload, null, 2), 'wakeup-schedule-backup.json');
  if (where) toast(`已导出到 ${where}`);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('prevWeek').onclick = () => setViewWeek(state.viewWeek - 1);
  $('nextWeek').onclick = () => setViewWeek(state.viewWeek + 1);
  $('backToday').onclick = () => setViewWeek(Math.max(1, calcCurrentWeek()));
  $('weekSelect').onchange = (e) => setViewWeek(Number(e.target.value));

  $('btnAdd').onclick = () => openCourseModal('add', null);
  $('fabAdd').onclick = () => openCourseModal('add', null);
  $('btnSettings').onclick = openSettings;
  $('btnTodayCourses').onclick = openTodayModal;
  $('btnImport').onclick = doImport;
  $('btnExport').onclick = doExport;

  $('btnEditCourse').onclick = () => {
    if (courseModalMode === 'view') {
      const c = state.courses.find(x => x.id === editingCourseId);
      if (c) openCourseModal('edit', c);
    } else {
      saveCourseFromForm();
    }
  };
  $('btnDeleteCourse').onclick = onDeleteClick;

  $('btnSaveSettings').onclick = saveSettings;
  $('s_alpha').oninput = (e) => $('alphaVal').textContent = e.target.value + '%';
  $('s_itemHeight').oninput = (e) => $('heightVal').textContent = e.target.value + 'px';
  $('s_sameLen').onchange = (e) => {
    $('sameLenEdit').hidden = !e.target.checked;
    buildTimeTable();
  };
  $('btnApplyLen').onclick = () => {
    const len = Number($('s_lessonLen').value) || 45;
    document.querySelectorAll('#timeTable .time-row').forEach(row => {
      const startInp = row.querySelector('input[data-field="start"]');
      const endInp = row.querySelector('input[data-field="end"]');
      if (startInp && startInp.value) endInp.value = addMinutes(startInp.value, len);
    });
    toast('已按统一时长更新全部下课时间');
  };

  // 关闭弹窗
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.hidden = true; });
  });

  // 键盘：← → 切周，Home 回本周，N 新增课程
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing) return;
    if (!$('courseModal').hidden || !$('settingsModal').hidden || !$('todayModal').hidden) {
      if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.hidden = true);
      return;
    }
    if (e.key === 'ArrowLeft') setViewWeek(state.viewWeek - 1);
    else if (e.key === 'ArrowRight') setViewWeek(state.viewWeek + 1);
    else if (e.key === 'Home') setViewWeek(Math.max(1, calcCurrentWeek()));
    else if (e.key === 'n' || e.key === 'N') openCourseModal('add', null);
  });

  // 触摸板横向滑动切周
  $('scheduleWrap').addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) {
      e.preventDefault();
      setViewWeek(state.viewWeek + (e.deltaX > 0 ? 1 : -1));
    }
  }, { passive: false });

  // 时间表编辑：统一时长模式下，改上课时间自动算下课时间
  $('timeTable').addEventListener('change', (e) => {
    const inp = e.target;
    if (inp.tagName !== 'INPUT' || !inp.dataset.ti) return;
    if ($('s_sameLen').checked && inp.dataset.field === 'start') {
      const len = Number($('s_lessonLen').value) || 45;
      const endInp = inp.parentElement.querySelector('input[data-field="end"]');
      if (endInp && inp.value) endInp.value = addMinutes(inp.value, len);
    }
  });
}

// ---------- 启动 ----------
async function init() {
  if (!Ports.isElectron) $('modeBadge').hidden = false;

  const text = await Ports.storage.load();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
  state.settings = normalizeSettings(data ? data.settings : null);
  state.courses = (data && Array.isArray(data.courses) ? data.courses : []).map(normalizeCourse);

  document.documentElement.dataset.theme = state.settings.theme;
  const cur = calcCurrentWeek();
  state.viewWeek = Math.min(state.settings.totalWeeks, Math.max(1, cur));

  const firstRun = !data || !data.courses || data.courses.length === 0;
  buildWeekSelect();
  bindEvents();
  render();
  renderTodayInfo();
  if (firstRun) toast('欢迎使用 WakeUp 课程表本地版！请先到「设置」填写学期开始日期', 3500);
}

init();
