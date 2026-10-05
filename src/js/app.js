// ============================================================
// WakeUp 课程表 · 本地还原版 · UI 层（v2）
// 仅负责渲染与交互：领域逻辑在 core/（model/week/conflict/merge/codec），
// 平台能力经 Ports 端口注入（adapters/）。数据格式 wakeup-local/2。
// ============================================================

// ---------- 常量 ----------
const COURSE_COLORS = ['#e8935a', '#9b7fd4', '#e088ac', '#5fa284', '#6c9bd9', '#d8739e', '#5a83be', '#4db6ac', '#ef9a5c', '#4a7fc1'];
const DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
const ODD_NAMES = ['每周', '单周', '双周'];
const GAP = 4; // 节次间距（对应原版 marTop）

// 极简线条图标（仿新版 WakeUp 的描边风格，随文字颜色）
const svgIco = (paths, w = 15) =>
  `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
  calendar: svgIco('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
  clock: svgIco('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  room: svgIco('<path d="M12 21s-6.5-5.3-6.5-10a6.5 6.5 0 1 1 13 0C18.5 15.7 12 21 12 21z"/><circle cx="12" cy="10.8" r="2.2"/>'),
  teacher: svgIco('<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.9-3.5 3.5-5.3 6.5-5.3s5.6 1.8 6.5 5.3"/>'),
  note: svgIco('<path d="M5 4h9.5L19 8.5V20H5z"/><path d="M14 4v5h5"/><path d="M8.5 13h7M8.5 16.5h4.5"/>')
};

// ---------- 内核与端口 ----------
const M = WakeupModel, W = WakeupWeek, C = WakeupConflict, Mrg = WakeupMerge, Bk = WakeupBackupCodec;
const Share = WakeupShareCodec, Csv = WakeupCsvCodec, Ics = WakeupIcsCodec;
const { parseDate, fmtDate, addDays, mondayIndex, toMinutes: toMin, addMinutes } = W;
const Ports = window.__ports;

// ---------- 状态 ----------
let state = null;            // v2 AppState（init 时加载/迁移）
let viewWeek = 1;            // 当前查看周（UI 态）
let courseModalMode = 'view';// view | edit | add
let editingCourseId = null;
let editingSlotId = null;    // 从具体课程块进入时的删除范围上下文
let pickedColor = -1;

// ---------- 小工具 ----------
const $ = (id) => document.getElementById(id);

function currentSchedule() {
  return state.schedules.find(s => s.id === state.currentScheduleId) || state.schedules[0];
}
function currentSettings() { return currentSchedule().settings; }
function findCourse(id) {
  return currentSchedule().courses.find(c => c.id === id) || null;
}
function touchSchedule() {
  currentSchedule().updatedAt = Date.now();
  state.updatedAt = Date.now();
}

function showToast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function persist() { await Ports.storage.save(Bk.serialize(state)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// 自动配色的随机池：仅含均匀分布在色环上的基础色（红橙黄绿蓝紫）
const RANDOM_COLORS = ['#e85454', '#e8933c', '#d9b83c', '#5aa66a', '#4a83c9', '#8a63d2'];

function effectiveColorIndex(c) {
  if (typeof c.color === 'number' && c.color >= 0 && c.color <= 9) return c.color;
  const code = c.name ? c.name.charCodeAt(0) : NaN;
  return isNaN(code) ? 0 : code % RANDOM_COLORS.length; // 自动：课程名首字 hash 到基础随机池
}

// 课程最终生效颜色（支持自定义 hex / 库色 / 自动随机池）
function courseHex(c) {
  if (typeof c.color === 'string' && /^#[0-9a-f]{6}$/.test(c.color)) return c.color;
  if (typeof c.color === 'number' && c.color >= 0) return COURSE_COLORS[c.color];
  const code = c.name ? c.name.charCodeAt(0) : NaN;
  return isNaN(code) ? RANDOM_COLORS[0] : RANDOM_COLORS[code % RANDOM_COLORS.length];
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// 课程块样式：颜色按透明度叠在页面底色上，按混合亮度自动取黑/白文字
function courseBlockStyle(c) {
  const [r, g, b] = hexToRgb(courseHex(c));
  const card = state.prefs.theme === 'dark' ? [42, 46, 55] : [250, 250, 253];
  const a = currentSettings().alpha / 100;
  const blend = [r, g, b].map((ch, i) => Math.round(ch * a + card[i] * (1 - a)));
  const lum = 0.299 * blend[0] + 0.587 * blend[1] + 0.114 * blend[2];
  return { bg: `rgba(${r}, ${g}, ${b}, ${a})`, text: lum > 165 ? '#20242a' : '#ffffff' };
}

// 展开为渲染条目：{course, slot}
function allEntries() {
  return currentSchedule().courses.flatMap(c => c.timeSlots.map(t => ({ course: c, slot: t })));
}

// ---------- 周计算（薄封装到当前课表） ----------
function calcCurrentWeek() { return W.calcCurrentWeek(currentSettings().termStart); }
function dayDate(w, day) { return W.dayDate(currentSettings().termStart, w, day); }

// ---------- 渲染 ----------
function dayOrder() {
  return currentSettings().sundayFirst ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
}

function render() {
  const s = currentSettings();
  const todayStr = fmtDate(new Date());
  const days = dayOrder();
  // 周六/周日独立开关（旧 showWeekend 已迁移）；关闭仅隐藏对应列
  const visibleDays = days.filter(d => d <= 5 || (d === 6 && s.showSaturday) || (d === 7 && s.showSunday));

  const grid = $('grid');
  grid.style.setProperty('--day-count', visibleDays.length);
  grid.style.setProperty('--unit', s.itemHeight + 'px');
  grid.style.setProperty('--col-bg-a', s.showColBg ? s.colBgAlpha / 100 : 0);
  grid.style.setProperty('--header-fs', s.headerTextSize + 'px');
  grid.style.setProperty('--ow-alpha', s.otherWeekAlpha / 100);
  grid.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  const weekMonday = dayDate(viewWeek, 1);
  corner.innerHTML = `<span class="month">${weekMonday.getMonth() + 1}<small>月</small></span>`;
  grid.appendChild(corner);

  for (const d of visibleDays) {
    const date = dayDate(viewWeek, d);
    const h = document.createElement('div');
    h.className = 'day-header' + (fmtDate(date) === todayStr ? ' is-today' : '');
    h.innerHTML = `<span class="day-name">${DAY_NAMES[d]}</span><span class="day-date">${date.getMonth() + 1}/${date.getDate()}</span>`;
    grid.appendChild(h);
  }

  const timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (let i = 1; i <= s.classNum; i++) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    sec.style.top = ((i - 1) * (s.itemHeight + GAP) + GAP) + 'px';
    sec.innerHTML = `<span class="sec-no">${i}</span><span>${s.times[i - 1].start}</span><span>${s.times[i - 1].end}</span>`;
    timeCol.appendChild(sec);
  }
  grid.appendChild(timeCol);

  for (const d of visibleDays) {
    const col = document.createElement('div');
    col.className = 'day-col';
    col.dataset.day = d;

    const dayEntries = allEntries()
      .filter(e => e.slot.day === d)
      .sort((a, b) => entryStartMin(a) - entryStartMin(b));

    for (const e of dayEntries) {
      const inWeek = C.slotInWeek(e.slot, viewWeek);
      if (!inWeek && !s.showOtherWeek) continue;
      col.appendChild(buildCourseBlock(e, inWeek));
    }

    col.addEventListener('dblclick', (ev) => {
      const rect = col.getBoundingClientRect();
      const y = ev.clientY - rect.top - GAP;
      const sec = Math.max(1, Math.min(s.classNum, Math.floor(y / (s.itemHeight + GAP)) + 1));
      openCourseModal('add', null, null, { day: d, start: sec });
    });

    grid.appendChild(col);
  }

  $('emptyTip').hidden = currentSchedule().courses.length !== 0;
  updateWeekUI();
}

// 排序用：条目开始分钟数（自定义时间优先，否则按节次时间）
function entryStartMin(e) {
  const s = currentSettings();
  if (e.slot.customTime) return toMin(e.slot.customTime.start);
  return toMin(s.times[Math.min(e.slot.start, s.classNum) - 1].start);
}

function buildCourseBlock(e, isCurrent) {
  const s = currentSettings();
  const { course: c, slot: sl } = e;
  const el = document.createElement('div');
  el.className = 'course-block' + (isCurrent ? '' : ' other-week');

  let top, height;
  if (sl.customTime) {
    // 还原原版"自定义时间课程按比例显示"
    const dayStart = toMin(s.times[0].start);
    const dayEnd = toMin(s.times[s.classNum - 1].end);
    const span = Math.max(1, dayEnd - dayStart);
    const totalH = s.classNum * s.itemHeight + (s.classNum - 1) * GAP;
    top = Math.max(0, (toMin(sl.customTime.start) - dayStart) / span * totalH);
    height = Math.max(14, (toMin(sl.customTime.end) - toMin(sl.customTime.start)) / span * totalH);
  } else {
    top = (sl.start - 1) * (s.itemHeight + GAP) + GAP;
    height = sl.step * s.itemHeight + (sl.step - 1) * GAP;
  }
  el.style.top = top + 'px';
  el.style.height = height + 'px';

  const style = courseBlockStyle(c);
  el.style.background = style.bg;
  el.style.color = style.text;
  el.style.fontSize = s.courseTextSize + 'px';
  el.style.borderRadius = s.cornerRadius + 'px';
  if (s.textHCenter) el.classList.add('txt-hcenter');
  if (s.textVCenter) el.classList.add('txt-vcenter');

  let html = '';
  if (sl.isOdd === 1) html += `<div class="course-tag">单周</div>`;
  if (sl.isOdd === 2) html += `<div class="course-tag">双周</div>`;
  if (sl.customTime) html += `<div class="course-tag">${sl.customTime.start}~${sl.customTime.end}</div>`;
  if (s.showTimeInGrid && !sl.customTime) html += `<div class="course-sec">${sl.start}-${sl.start + sl.step - 1}节</div>`;
  html += `<div class="course-name">${escapeHtml(c.name)}</div>`;
  if (s.showTeachInGrid && sl.teach) html += `<div class="course-teach">${escapeHtml(sl.teach)}</div>`;
  if (sl.room) html += `<div class="course-room">@${escapeHtml(sl.room)}</div>`;
  // 预留接口：showNoteInGrid（备注展示于格子内）待排版方案确定后接入
  el.innerHTML = html;

  el.title = `${c.name} ${sl.room ? '@' + sl.room : ''} ${sl.teach ? sl.teach + ' 老师' : ''}`.trim();
  el.addEventListener('click', () => openCourseModal('view', c, sl));
  return el;
}

// ---------- 顶栏与周数面板 ----------
function weekStatusText() {
  const s = currentSettings();
  const cur = calcCurrentWeek();
  if (viewWeek > s.totalWeeks) return '学期结束';
  if (cur < 1) return '未开学';
  if (viewWeek !== cur) return '非本周';
  return '';
}

function updateWeekUI() {
  $('weekLabel').textContent = `第 ${viewWeek} 周`;
  $('weekStatus').textContent = weekStatusText();
  // 标题行：课表名（大）+ 周序数（小）同行，均可设置关闭；两项全关仅剩切周箭头
  const s = currentSettings();
  const name = $('schName');
  name.textContent = currentSchedule().name;
  name.hidden = !s.showSchName;
  $('weekTitleSpan').hidden = !s.showWeekTitle;
  const d = new Date();
  $('todayInfo').textContent = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const slider = $('wpSlider');
  slider.max = s.totalWeeks;
  slider.value = viewWeek;
  $('wpVal').textContent = `第${viewWeek}周`;
  renderSchCards();
}

function renderSchCards() {
  const box = $('schCards');
  box.innerHTML = '';
  for (const s of state.schedules) {
    const card = document.createElement('div');
    card.className = 'sch-card' + (s.id === state.currentScheduleId ? ' active' : '');
    card.innerHTML = `${s.id === state.currentScheduleId ? '<span class="sc-check">✓</span>' : ''}
      <span>${escapeHtml(s.name)}</span><span class="sc-count">${s.courses.length} 门课</span>`;
    card.onclick = () => { switchSchedule(s.id); closeModal('weekPanel'); };
    box.appendChild(card);
  }
}

function setViewWeek(w) {
  viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, w));
  updateWeekUI();
  render();
}

// ---------- 课程弹窗（详情 / 编辑 / 添加） ----------
function openCourseModal(mode, course, slot, preset = {}) {
  courseModalMode = mode;
  editingCourseId = course ? course.id : null;
  editingSlotId = slot ? slot.id : null;

  $('courseModalTitle').textContent = mode === 'add' ? '添加课程' : (mode === 'edit' ? '修改课程' : '课程详情');
  const isView = mode === 'view';
  $('btnEditCourse').textContent = isView ? '编辑' : (mode === 'add' ? '添加' : '保存');
  $('btnEditCourse').classList.toggle('primary', !isView);
  $('btnEditCourse').classList.toggle('big', isView);
  $('btnDeleteCourse').hidden = mode === 'add';
  $('btnDeleteCourse').classList.remove('armed');
  $('btnCancelCourse').hidden = isView;
  $('deleteScopeArea').hidden = true;
  deleteArmed = false;
  $('formTip').textContent = '';

  const c = course || M.normalizeCourse({
    name: '',
    timeSlots: [{
      day: preset.day || 1,
      start: preset.start || 1, step: 1,
      startWeek: 1, endWeek: currentSettings().totalWeeks
    }]
  });

  if (mode === 'view') {
    $('courseDetail').hidden = false;
    $('courseForm').hidden = true;
    renderCourseDetail(c, slot);
  } else {
    $('courseDetail').hidden = true;
    $('courseForm').hidden = false;
    fillCourseForm(c);
  }
  openModal('courseModal');
}

function slotTimeText(sl) {
  const s = currentSettings();
  if (sl.customTime) return `${sl.customTime.start} ~ ${sl.customTime.end}`;
  const t1 = s.times[Math.min(sl.start, s.classNum) - 1] || { start: '--:--' };
  const t2 = s.times[Math.min(sl.start + sl.step - 1, s.classNum) - 1] || { end: '--:--' };
  return `${t1.start} ~ ${t2.end}`;
}

function renderCourseDetail(c, slot) {
  const color = courseHex(c);
  const conflicts = C.conflictsOf(allEntries(), c.id, slot ? slot.id : null);

  const slotBlocks = c.timeSlots.map(sl => {
    const inWeek = C.slotInWeek(sl, viewWeek);
    return `
    <div class="dt-slot-block">
      <div class="dt-row"><span class="dt-ico">${ICONS.calendar}</span><span class="dt-txt">第${sl.startWeek} - ${sl.endWeek}周${sl.isOdd ? ' · ' + ODD_NAMES[sl.isOdd] : ''}${inWeek ? '' : '<div class="dt-sub">非本周</div>'}</span></div>
      <div class="dt-row"><span class="dt-ico">${ICONS.clock}</span><span class="dt-txt">${DAY_NAMES[sl.day]} 第${sl.start} - ${sl.start + sl.step - 1}节<div class="dt-sub">${slotTimeText(sl).replace(' ~ ', ' - ')}</div></span></div>
      ${sl.room ? `<div class="dt-row"><span class="dt-ico">${ICONS.room}</span><span class="dt-txt">${escapeHtml(sl.room)}</span></div>` : ''}
      ${sl.teach ? `<div class="dt-row"><span class="dt-ico">${ICONS.teacher}</span><span class="dt-txt">${escapeHtml(sl.teach)}</span></div>` : ''}
    </div>`;
  }).join('');

  const conflictHtml = conflicts.length ? `
    <div class="conflict-list">
      <div class="conflict-title">${svgIco('<path d="M12 4L2.8 19.5h18.4L12 4z"/><path d="M12 10v4.2M12 17.2v.1"/>', 14)} 存在 ${conflicts.length} 处时间冲突</div>
      ${conflicts.map(p => {
        const o = p.a.course.id === c.id ? p.b : p.a;
        const os = p.a.course.id === c.id ? p.b.slot : p.a.slot;
        return `<div class="conflict-item">与《${escapeHtml(o.name)}》${DAY_NAMES[os.day]} 第${os.start}~${os.start + os.step - 1}节 重叠</div>`;
      }).join('')}
    </div>` : '';

  $('courseDetail').innerHTML = `
    <div class="dt-name">
      <span class="dt-bar" style="background:${color}"></span>
      <span class="dt-title">${escapeHtml(c.name)}</span>
      ${c.credit ? `<span class="dt-credit">${c.credit} 学分</span>` : ''}
    </div>
    ${slotBlocks}
    ${c.note ? `<div class="dt-row"><span class="dt-ico">${ICONS.note}</span><span class="dt-txt dt-note">${escapeHtml(c.note)}</span></div>` : ''}
    ${conflictHtml}
  `;
}

function fillCourseForm(c) {
  $('f_name').value = c.name;
  $('f_credit').value = (c.credit === null || c.credit === undefined) ? '' : c.credit;
  $('f_note').value = c.note || '';
  pickedColor = typeof c.color === 'number' ? c.color
    : (typeof c.color === 'string' && /^#[0-9a-f]{6}$/.test(c.color) ? c.color : -1);
  $('colorPick').hidden = true;
  $('customColorRow').hidden = true;
  updateColorUI();
  renderSlotCards(c.timeSlots);
}

// 「点击修改颜色」行：按钮颜色 + 预览块 + hex 输入，三者实时反映当前生效颜色
function pickedHex() {
  if (typeof pickedColor === 'string') return pickedColor;
  if (typeof pickedColor === 'number' && pickedColor >= 0) return COURSE_COLORS[pickedColor];
  const name = $('f_name').value.trim();
  const code = name ? name.charCodeAt(0) : NaN;
  return isNaN(code) ? RANDOM_COLORS[0] : RANDOM_COLORS[code % RANDOM_COLORS.length];
}

function updateColorUI() {
  const hex = pickedHex();
  $('btnToggleColor').style.color = hex;
  $('ccPreview').style.background = hex;
  if (document.activeElement !== $('ccHex')) $('ccHex').value = hex.slice(1).toUpperCase();
}

// 色板：库中 10 色 + 最右自定义按钮
function buildColorPick() {
  const box = $('colorPick');
  box.innerHTML = '';
  COURSE_COLORS.forEach((hex, i) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (pickedColor === i ? ' selected' : '');
    sw.style.background = hex;
    sw.title = `颜色 ${i + 1}`;
    sw.onclick = () => {
      pickedColor = i;
      $('customColorRow').hidden = true;
      updateColorUI();
      buildColorPick();
    };
    box.appendChild(sw);
  });
  const custom = document.createElement('div');
  custom.className = 'color-swatch custom' + (typeof pickedColor === 'string' ? ' selected' : '');
  custom.title = '自定义颜色';
  custom.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-1.8a2.2 2.2 0 0 0-1.6 3.7c.5.6.4 1.6-.4 2a8.8 8.8 0 0 1-2.2.3z"/><circle cx="7.8" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.2" cy="10.5" r="1.1" fill="currentColor" stroke="none"/></svg>';
  custom.onclick = () => {
    const row = $('customColorRow');
    if (row.hidden) openCustomPicker(pickedHex());
    else row.hidden = true;
  };
  box.appendChild(custom);
}

// ---------- 自定义取色器（SV 方块 + 色相条，拖动实时应用） ----------
const cpCtx = { h: 30, s: 1, v: 1, editing: false, prev: null };

function openCustomPicker(hex) {
  const { h, s, v } = hexToHsv(hex);
  Object.assign(cpCtx, { h, s, v, prev: pickedColor });
  $('customColorRow').hidden = false;
  renderCustomPicker();
}

function renderCustomPicker() {
  const { h, s, v } = cpCtx;
  $('cpSv').style.background =
    `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
  $('cpDot').style.left = (s * 100) + '%';
  $('cpDot').style.top = ((1 - v) * 100) + '%';
  $('cpDot').style.background = hsvToHex(h, s, v);
  $('cpHueDot').style.left = (h / 360 * 100) + '%';
  $('cpHueDot').style.background = `hsl(${h}, 100%, 50%)`;
}

// 拖动/hue 改变 → 实时写回 pickedColor 并刷新按钮与预览
function applyPickerColor() {
  pickedColor = hsvToHex(cpCtx.h, cpCtx.s, cpCtx.v);
  updateColorUI();
  buildColorPick();
}

function bindPickerDrag(el, onmove) {
  const apply = (e) => {
    const r = el.getBoundingClientRect();
    onmove(
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    );
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    cpCtx.editing = true;
    apply(e);
  });
  el.addEventListener('pointermove', (e) => { if (cpCtx.editing) apply(e); });
  el.addEventListener('pointerup', () => { cpCtx.editing = false; });
}

// ---------- 时间段卡片 ----------
function sectionOptions(sel) {
  const s = currentSettings();
  let html = '';
  for (let i = 1; i <= s.classNum; i++) html += `<option value="${i}" ${i === sel ? 'selected' : ''}>第${i}节</option>`;
  return html;
}

function renderSlotCards(slots) {
  const box = $('slotList');
  box.innerHTML = '';
  slots.forEach((sl, i) => box.appendChild(slotCard(sl, i)));
}

function slotCard(sl, idx) {
  const s = currentSettings();
  const endSec = Math.min(sl.start + sl.step - 1, s.classNum);
  const card = document.createElement('div');
  card.className = 'slot-card';
  card.dataset.mode = 'week';
  card.innerHTML = `
    <div class="slot-head">
      <span>时间段 ${idx + 1}</span>
      <button type="button" class="slot-remove" title="删除此时间段">×</button>
    </div>
    <button type="button" class="slot-row-btn sf-week-btn">
      <span class="sr-ico">${ICONS.calendar}</span><span class="sr-txt sf-week-label"></span>
      <span class="chev">›</span>
    </button>
    <div class="sr-hidden">
      <select class="sf-odd">${[0, 1, 2].map(v => `<option value="${v}" ${v === sl.isOdd ? 'selected' : ''}>${ODD_NAMES[v]}</option>`).join('')}</select>
      <input class="sf-sw" value="${sl.startWeek}">
      <input class="sf-ew" value="${Math.max(sl.endWeek, sl.startWeek)}">
      <input type="date" class="sf-df">
      <input type="date" class="sf-dt">
    </div>
    <button type="button" class="slot-row-btn sf-time-btn">
      <span class="sr-ico">${ICONS.clock}</span><span class="sr-txt sf-time-label"></span>
      <span class="chev">›</span>
    </button>
    <div class="sr-hidden">
      <select class="sf-day">${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}" ${d === sl.day ? 'selected' : ''}>${DAY_NAMES[d]}</option>`).join('')}</select>
      <select class="sf-start">${sectionOptions(Math.min(sl.start, s.classNum))}</select>
      <select class="sf-end">${sectionOptions(Math.max(1, endSec))}</select>
    </div>
    <div class="slot-custom-row">
      <label><input type="checkbox" class="sf-custom" ${sl.customTime ? 'checked' : ''}>自定义时间</label>
      <div class="ct-times" ${sl.customTime ? '' : 'hidden'}>
        <input type="time" class="sf-cts" value="${sl.customTime ? sl.customTime.start : '08:00'}">
        <span>~</span>
        <input type="time" class="sf-cte" value="${sl.customTime ? sl.customTime.end : '09:40'}">
      </div>
    </div>
    <div class="cf-row"><span class="cf-ico">${ICONS.teacher}</span><input type="text" class="sf-teach" maxlength="20" value="${escapeHtml(sl.teach)}" placeholder="授课老师（可不填）"></div>
    <div class="cf-row"><span class="cf-ico">${ICONS.room}</span><input type="text" class="sf-room" maxlength="30" value="${escapeHtml(sl.room)}" placeholder="教室（可不填）"></div>
  `;
  card.querySelector('.sf-week-btn').onclick = () => openWeekDlg(card);
  card.querySelector('.sf-time-btn').onclick = () => openTimeDlg(card);
  updateSlotLabels(card);
  return card;
}

// 由隐藏控件刷新卡片摘要文字
function updateSlotLabels(card) {
  const mode = card.dataset.mode;
  const sw = Number(card.querySelector('.sf-sw').value);
  const ew = Number(card.querySelector('.sf-ew').value);
  const odd = Number(card.querySelector('.sf-odd').value);
  const wl = card.querySelector('.sf-week-label');
  if (mode === 'date') {
    const df = card.querySelector('.sf-df').value, dt = card.querySelector('.sf-dt').value;
    wl.textContent = df && dt ? `日期 ${df} ~ ${dt}` : '日期模式（自动换算周数）';
  } else {
    wl.textContent = `第${sw} - ${ew}周` + (odd ? ` · ${ODD_NAMES[odd]}` : '');
  }
  const day = Number(card.querySelector('.sf-day').value);
  const st = Number(card.querySelector('.sf-start').value);
  const en = Number(card.querySelector('.sf-end').value);
  card.querySelector('.sf-time-label').textContent = `${DAY_NAMES[day]} 第${st} - ${en}节`;
}

// ---------- 周次选择弹窗（数字网格 / 日期模式） ----------
let wdCtx = null; // {card, start, end, odd, mode, picking}

function openWeekDlg(card) {
  wdCtx = {
    card,
    start: Number(card.querySelector('.sf-sw').value),
    end: Number(card.querySelector('.sf-ew').value),
    odd: Number(card.querySelector('.sf-odd').value),
    mode: card.dataset.mode === 'date' ? 'date' : 'week',
    picking: false
  };
  $('wdDf').value = card.querySelector('.sf-df').value || '';
  $('wdDt').value = card.querySelector('.sf-dt').value || '';
  renderWeekDlg();
  openModal('weekDlg');
}

function renderWeekDlg() {
  const dateMode = wdCtx.mode === 'date';
  $('wgGrid').hidden = dateMode;
  $('wgDate').hidden = !dateMode;
  $('wgQuick').hidden = dateMode;
  $('wdModeBtn').textContent = dateMode ? '周次模式' : '日期模式';

  if (!dateMode) {
    const total = currentSettings().totalWeeks;
    const grid = $('wgGrid');
    grid.innerHTML = '';
    for (let w = 1; w <= total; w++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'wg-cell' + (w >= wdCtx.start && w <= wdCtx.end ? ' sel' : '');
      cell.textContent = w;
      cell.onclick = () => {
        if (wdCtx.picking) {
          wdCtx.end = w;
          if (wdCtx.end < wdCtx.start) [wdCtx.start, wdCtx.end] = [wdCtx.end, wdCtx.start];
          wdCtx.picking = false;
        } else {
          wdCtx.start = wdCtx.end = w;
          wdCtx.picking = true;
        }
        renderWeekDlg();
      };
      grid.appendChild(cell);
    }
    $('wgAll').classList.toggle('on', wdCtx.odd === 0);
    $('wgOdd').classList.toggle('on', wdCtx.odd === 1);
    $('wgEven').classList.toggle('on', wdCtx.odd === 2);
  }
}

// ---------- 时间选择弹窗（三列点选） ----------
let tpCtx = null; // {card, day, start, end}

function openTimeDlg(card) {
  tpCtx = {
    card,
    day: Number(card.querySelector('.sf-day').value),
    start: Number(card.querySelector('.sf-start').value),
    end: Number(card.querySelector('.sf-end').value)
  };
  renderTimeDlg();
  openModal('timeDlg');
}

function secValList(a, b) {
  const r = [];
  for (let i = a; i <= b; i++) r.push({ value: i, label: `第${i}节` });
  return r;
}

function renderTimeDlg() {
  const s = currentSettings();
  const fill = (boxId, vals, cur, onpick) => {
    const box = $(boxId);
    box.querySelectorAll('button').forEach(b => b.remove());
    for (const v of vals) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v.label;
      b.classList.toggle('sel', v.value === cur);
      b.onclick = () => onpick(v.value);
      box.appendChild(b);
    }
    // 选中项滚动到可视区（列已是固定高度滚动窗口）
    const sel = box.querySelector('button.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
  };
  fill('tpDay', [1, 2, 3, 4, 5, 6, 7].map(d => ({ value: d, label: DAY_NAMES[d] })), tpCtx.day,
    v => { tpCtx.day = v; renderTimeDlg(); });
  fill('tpStart', secValList(1, s.classNum), tpCtx.start,
    v => { tpCtx.start = v; if (tpCtx.end < v) tpCtx.end = v; renderTimeDlg(); });
  fill('tpEnd', secValList(tpCtx.start, s.classNum), tpCtx.end,
    v => { tpCtx.end = v; renderTimeDlg(); });
}

// 时间段列表事件（委托）
function bindSlotListEvents() {
  const box = $('slotList');
  box.addEventListener('click', (e) => {
    if (e.target.closest('.slot-remove')) {
      const cards = box.querySelectorAll('.slot-card');
      if (cards.length <= 1) { showToast('至少保留一个时间段'); return; }
      e.target.closest('.slot-card').remove();
      renumberSlots();
    }
  });
  box.addEventListener('change', (e) => {
    if (e.target.classList.contains('sf-custom')) {
      const card = e.target.closest('.slot-card');
      card.querySelector('.ct-times').hidden = !e.target.checked;
    }
  });
}

function renumberSlots() {
  document.querySelectorAll('#slotList .slot-card').forEach((card, i) => {
    card.querySelector('.slot-head span').textContent = '时间段 ' + (i + 1);
  });
}

function readCourseForm() {
  const s = currentSettings();
  const name = $('f_name').value.trim();
  if (!name) return { err: '请填写课程名' };
  const cards = [...document.querySelectorAll('#slotList .slot-card')];
  if (!cards.length) return { err: '至少需要一个时间段' };

  const slots = [];
  for (const card of cards) {
    const start = Number(card.querySelector('.sf-start').value);
    const end = Number(card.querySelector('.sf-end').value);
    if (!start || !end || start > end) return { err: '存在时间段节次不合法（结束节需不小于开始节）' };

    let sw, ew;
    if (card.dataset.mode === 'date') {
      const df = card.querySelector('.sf-df').value;
      const dt = card.querySelector('.sf-dt').value;
      if (!df || !dt) return { err: '日期模式需填写起止日期' };
      ({ startWeek: sw, endWeek: ew } = W.weeksFromDates(s.termStart, df, dt));
    } else {
      sw = Number(card.querySelector('.sf-sw').value);
      ew = Number(card.querySelector('.sf-ew').value);
      if (!sw || !ew || sw > ew) return { err: '存在时间段周次不合法（结束周需不小于开始周）' };
    }

    let customTime = null;
    if (card.querySelector('.sf-custom').checked) {
      const cts = card.querySelector('.sf-cts').value;
      const cte = card.querySelector('.sf-cte').value;
      if (!cts || !cte || cts >= cte) return { err: '自定义时间不合法（结束需晚于开始）' };
      customTime = { start: cts, end: cte };
    }

    slots.push(M.normalizeSlot({
      day: Number(card.querySelector('.sf-day').value),
      start, step: end - start + 1,
      startWeek: sw, endWeek: ew,
      isOdd: Number(card.querySelector('.sf-odd').value),
      room: card.querySelector('.sf-room').value.trim(),
      teach: card.querySelector('.sf-teach').value.trim(),
      customTime
    }));
  }

  const credit = $('f_credit').value.trim();
  const course = M.normalizeCourse({
    id: editingCourseId,
    updatedAt: Date.now(),
    name,
    color: pickedColor,
    credit: credit === '' ? null : Number(credit),
    note: $('f_note').value.trim(),
    timeSlots: slots
  });

  // 冲突软提示（跨课程）
  const others = currentSchedule().courses.filter(x => x.id !== course.id);
  const entries = [
    ...others.flatMap(o => o.timeSlots.map(t => ({ course: o, slot: t }))),
    ...course.timeSlots.map(t => ({ course, slot: t }))
  ];
  const pair = C.findConflicts(entries).find(p =>
    p.a.course.id === course.id || p.b.course.id === course.id);

  return { course, conflict: pair ? (pair.a.course.id === course.id ? pair.b.course : pair.a.course) : null };
}

function saveCourseFromForm() {
  const r = readCourseForm();
  if (r.err) { $('formTip').textContent = r.err; return; }
  if (r.conflict && !confirm(`与课程「${r.conflict.name}」时间冲突，仍要保存吗？`)) return;
  const c = r.course;

  if (courseModalMode === 'edit') {
    const i = currentSchedule().courses.findIndex(x => x.id === editingCourseId);
    if (i >= 0) currentSchedule().courses[i] = c;
  } else {
    currentSchedule().courses.push(c);
  }
  touchSchedule();
  persist();
  closeModal('courseModal');
  render();
  showToast(courseModalMode === 'edit' ? '修改成功' : '添加成功');
}

// ---------- 删除（还原原版"删除时询问时间范围" + 双重确认） ----------
let deleteArmed = false;

function removeCourse(id) {
  const sch = currentSchedule();
  sch.courses = sch.courses.filter(x => x.id !== id);
  sch.tombstones[id] = Date.now(); // 墓碑：防止合并时被旧数据复活
}

function onDeleteClick() {
  const c = findCourse(editingCourseId);
  if (!c) return;
  if (c.timeSlots.length > 1 && editingSlotId) {
    // 多时间段且从具体块进入 → 展示范围选择（还原原版语义）
    $('deleteScopeArea').hidden = false;
    $('btnDeleteCourse').hidden = true;
    return;
  }
  if (!deleteArmed) {
    deleteArmed = true;
    const btn = $('btnDeleteCourse');
    btn.title = '再点一次确认删除';
    btn.classList.add('armed');
    setTimeout(() => {
      deleteArmed = false;
      btn.title = '删除';
      btn.classList.remove('armed');
    }, 3000);
    return;
  }
  removeCourse(c.id);
  touchSchedule();
  persist();
  closeModal('courseModal');
  render();
  showToast('删除成功');
}

function deleteSlot(armedBtn) {
  const c = findCourse(editingCourseId);
  if (!c) return;
  if (c.timeSlots.length <= 1) { onDeleteWholeCourse(); return; }
  c.timeSlots = c.timeSlots.filter(t => t.id !== editingSlotId);
  c.updatedAt = Date.now();
  touchSchedule();
  persist();
  closeModal('courseModal');
  render();
  showToast('已删除该时间段');
}

function onDeleteWholeCourse() {
  removeCourse(editingCourseId);
  touchSchedule();
  persist();
  closeModal('courseModal');
  render();
  showToast('删除成功');
}

// 范围按钮各自的双重确认
function bindDeleteScopeButtons() {
  const armConfirm = (btn, label, action) => {
    let armed = false;
    btn.onclick = () => {
      if (!armed) {
        armed = true;
        btn.textContent = label;
        btn.classList.add('armed');
        setTimeout(() => { armed = false; btn.textContent = btn.dataset.text; btn.classList.remove('armed'); }, 3000);
        return;
      }
      action();
    };
  };
  const slotBtn = $('btnDeleteSlotOnly');
  const courseBtn = $('btnDeleteWholeCourse');
  slotBtn.dataset.text = '仅删除该时间段';
  courseBtn.dataset.text = '删除整门课程';
  armConfirm(slotBtn, '再点一次确认', deleteSlot);
  armConfirm(courseBtn, '再点一次确认', onDeleteWholeCourse);
  $('btnCancelDelete').onclick = () => {
    $('deleteScopeArea').hidden = true;
    $('btnDeleteCourse').hidden = false;
  };
}

// ---------- 弹窗开关 ----------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

// ---------- 课表管理（多课表） ----------
function switchSchedule(id) {
  if (!state.schedules.find(s => s.id === id)) return;
  state.currentScheduleId = id;
  state.updatedAt = Date.now();
  persist();
  viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, calcCurrentWeek()));
  updateWeekUI();
  render();
  showToast(`已切换到「${currentSchedule().name}」`);
}

function openScheduleManager() {
  renderScheduleList();
  openModal('scheduleModal');
}

function renderScheduleList() {
  const box = $('scheduleList');
  box.innerHTML = '';
  state.schedules.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sch-row';
    row.dataset.id = s.id;
    row.innerHTML = `
      <button type="button" class="icon-btn sch-up" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="icon-btn sch-down" title="下移" ${i === state.schedules.length - 1 ? 'disabled' : ''}>↓</button>
      <input type="text" class="sch-name" value="${escapeHtml(s.name)}" maxlength="30">
      <span class="sch-meta">${s.courses.length} 门课${s.id === state.currentScheduleId ? ' · 当前' : ''}</span>
      <button type="button" class="danger-btn sch-del">删除</button>
    `;
    box.appendChild(row);
  });
}

function bindScheduleManager() {
  $('btnNewSch').onclick = () => {
    closeModal('weekPanel');
    openModal('scheduleModal');
    $('newScheduleName').focus();
  };
  $('btnManageSch').onclick = () => {
    closeModal('weekPanel');
    openScheduleManager();
  };
  $('btnCreateSchedule').onclick = () => {
    const name = $('newScheduleName').value.trim();
    if (!name) { showToast('请输入新课表名称'); return; }
    const sch = M.normalizeSchedule({ name });
    state.schedules.push(sch);
    state.currentScheduleId = sch.id;
    state.updatedAt = Date.now();
    $('newScheduleName').value = '';
    persist();
    updateWeekUI();
    renderScheduleList();
    render();
    showToast(`已创建「${sch.name}」`);
  };

  const box = $('scheduleList');
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.sch-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('.sch-up') || e.target.closest('.sch-down')) {
      const idx = state.schedules.findIndex(s => s.id === id);
      const dir = e.target.closest('.sch-up') ? -1 : 1;
      const j = idx + dir;
      if (j < 0 || j >= state.schedules.length) return;
      [state.schedules[idx], state.schedules[j]] = [state.schedules[j], state.schedules[idx]];
      state.updatedAt = Date.now();
      persist();
      updateWeekUI();
      renderScheduleList();
      return;
    }
    if (e.target.closest('.sch-del')) {
      if (state.schedules.length <= 1) { showToast('至少保留一个课表'); return; }
      const btn = e.target.closest('.sch-del');
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.classList.add('armed');
        btn.textContent = '确认删除?';
        setTimeout(() => { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.textContent = '删除'; }, 3000);
        return;
      }
      state.schedules = state.schedules.filter(s => s.id !== id);
      if (state.currentScheduleId === id) state.currentScheduleId = state.schedules[0].id;
      state.updatedAt = Date.now();
      persist();
      updateWeekUI();
      renderScheduleList();
      render();
      showToast('课表已删除');
    }
  });
  box.addEventListener('change', (e) => {
    if (!e.target.classList.contains('sch-name')) return;
    const row = e.target.closest('.sch-row');
    const s = state.schedules.find(x => x.id === row.dataset.id);
    if (!s) return;
    s.name = e.target.value.trim() || s.name;
    s.updatedAt = Date.now();
    state.updatedAt = Date.now();
    persist();
    updateWeekUI();
    row.querySelector('.sch-meta').textContent = `${s.courses.length} 门课${s.id === state.currentScheduleId ? ' · 当前' : ''}`;
  });
}

// ---------- 设置（挂当前课表） ----------
function openSettings() {
  const s = currentSettings();
  $('s_scheduleName').value = currentSchedule().name;
  $('s_termStart').value = s.termStart;
  $('s_totalWeeks').value = s.totalWeeks;
  const cnSel = $('s_classNum');
  cnSel.innerHTML = '';
  for (let i = 8; i <= 16; i++) cnSel.innerHTML += `<option value="${i}">${i} 节</option>`;
  cnSel.value = s.classNum;
  cnSel.onchange = (e) => buildTimeTable(Number(e.target.value)); // 节数变化即时同步时间表（保留已填值）
  $('s_alpha').value = s.alpha;
  $('alphaVal').textContent = s.alpha + '%';
  $('s_itemHeight').value = s.itemHeight;
  $('heightVal').textContent = s.itemHeight + 'px';
  $('s_showColBg').checked = s.showColBg;
  $('rowColBgAlpha').hidden = !s.showColBg;
  $('s_colBgAlpha').value = s.colBgAlpha;
  $('colBgAlphaVal').textContent = s.colBgAlpha + '%';
  $('s_showOtherWeek').checked = s.showOtherWeek;
  $('s_showSchName').checked = s.showSchName;
  $('s_showWeekTitle').checked = s.showWeekTitle;
  $('rowOtherWeekAlpha').hidden = !s.showOtherWeek;
  $('s_owAlpha').value = s.otherWeekAlpha;
  $('owAlphaVal').textContent = s.otherWeekAlpha + '%';
  $('s_headerFs').value = s.headerTextSize;
  $('headerFsVal').textContent = s.headerTextSize + 'px';
  $('s_showSaturday').checked = s.showSaturday;
  $('s_showSunday').checked = s.showSunday;
  $('rowSundayFirst').hidden = !s.showSunday;
  $('s_sundayFirst').checked = s.sundayFirst;
  $('s_textFs').value = s.courseTextSize;
  $('textFsVal').textContent = s.courseTextSize + 'px';
  $('s_radius').value = s.cornerRadius;
  $('radiusVal').textContent = s.cornerRadius + 'px';
  $('s_textHCenter').checked = s.textHCenter;
  $('s_textVCenter').checked = s.textVCenter;
  $('s_showTimeInGrid').checked = s.showTimeInGrid;
  $('s_showTeachInGrid').checked = s.showTeachInGrid;
  // 预留接口：s_showNoteInGrid / s_gridLines 已挂 UI，渲染逻辑后续版本接入
  $('s_showNoteInGrid').checked = s.showNoteInGrid;
  $('s_gridLines').checked = s.gridLines;
  $('s_sameLen').checked = s.sameLen;
  $('s_lessonLen').disabled = !s.sameLen;
  $('btnApplyLen').disabled = !s.sameLen;
  const [sh, sm] = s.times[0].start.split(':').map(Number);
  const [eh, em] = s.times[0].end.split(':').map(Number);
  $('s_lessonLen').value = (eh * 60 + em) - (sh * 60 + sm);
  $('timeTable').innerHTML = ''; // 清空上一次会话残留（未保存的修改随取消丢弃）
  buildTimeTable();
  openModal('settingsModal');
}

function buildTimeTable(count) {
  const s = currentSettings();
  const n = Number(count) || s.classNum;
  const box = $('timeTable');
  // 保留当前已填/已同步的时间（改节数、切换等长时不回退），去留在保存/取消时确定
  const prev = {};
  box.querySelectorAll('input[data-ti]').forEach(inp => {
    prev[inp.dataset.ti + ':' + inp.dataset.field] = inp.value;
  });
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const t = s.times[i] || { start: '08:00', end: '08:45' };
    const start = (i + ':start') in prev ? prev[i + ':start'] : t.start;
    const end = (i + ':end') in prev ? prev[i + ':end'] : t.end;
    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `
      <span class="t-no">${i + 1}</span>
      <input type="time" value="${start}" data-ti="${i}" data-field="start">
      <span class="t-sep">~</span>
      <input type="time" value="${end}" data-ti="${i}" data-field="end" ${s.sameLen ? 'disabled' : ''}>
    `;
    box.appendChild(row);
  }
}

function collectSettings() {
  const cur = currentSettings();
  const s = { ...cur };
  s.termStart = $('s_termStart').value || cur.termStart;
  s.totalWeeks = Number($('s_totalWeeks').value) || 20;
  s.classNum = Number($('s_classNum').value);
  s.alpha = Number($('s_alpha').value);
  s.itemHeight = Number($('s_itemHeight').value);
  s.showColBg = $('s_showColBg').checked;
  s.colBgAlpha = Number($('s_colBgAlpha').value);
  s.showOtherWeek = $('s_showOtherWeek').checked;
  s.showSchName = $('s_showSchName').checked;
  s.showWeekTitle = $('s_showWeekTitle').checked;
  s.otherWeekAlpha = Number($('s_owAlpha').value);
  s.headerTextSize = Number($('s_headerFs').value);
  s.showSaturday = $('s_showSaturday').checked;
  s.showSunday = $('s_showSunday').checked;
  s.sundayFirst = $('s_sundayFirst').checked;
  s.courseTextSize = Number($('s_textFs').value);
  s.cornerRadius = Number($('s_radius').value);
  s.textHCenter = $('s_textHCenter').checked;
  s.textVCenter = $('s_textVCenter').checked;
  s.showTimeInGrid = $('s_showTimeInGrid').checked;
  s.showTeachInGrid = $('s_showTeachInGrid').checked;
  s.showNoteInGrid = $('s_showNoteInGrid').checked;
  s.gridLines = $('s_gridLines').checked;
  s.sameLen = $('s_sameLen').checked;
  s.times = cur.times.map(t => ({ ...t }));
  document.querySelectorAll('#timeTable input[data-ti]').forEach(inp => {
    const i = Number(inp.dataset.ti);
    if (inp.value) s.times[i][inp.dataset.field] = inp.value;
  });
  if (s.sameLen) {
    const len = Number($('s_lessonLen').value) || 45;
    s.times.forEach(t => { t.end = addMinutes(t.start, len); });
  }
  return s;
}

function saveSettings() {
  const sch = currentSchedule();
  const oldTermStart = sch.settings.termStart;
  sch.name = $('s_scheduleName').value.trim() || sch.name;
  sch.settings = M.normalizeSettings(collectSettings());

  viewWeek = Math.min(sch.settings.totalWeeks, Math.max(1, viewWeek));
  if (oldTermStart !== sch.settings.termStart) {
    viewWeek = Math.min(sch.settings.totalWeeks, Math.max(1, calcCurrentWeek()));
  }
  touchSchedule();
  persist();
  updateWeekUI();
  render();
  closeModal('settingsModal');
  showToast('设置已保存');
}

// ---------- 今日课程 ----------
function toggleTheme() {
  state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.prefs.theme;
  updateThemeToggleLabel();
  persist();
  render();
}

const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>'
};

function updateThemeToggleLabel() {
  const dark = state.prefs.theme === 'dark';
  $('pfThemeIco').innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
  $('pfThemeTxt').textContent = dark ? '日间模式' : '夜间模式';
}

function openTodayModal() {
  const now = new Date();
  const todayDay = now.getDay() === 0 ? 7 : now.getDay();
  const curWeek = calcCurrentWeek();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  $('todayModalTitle').textContent = `今日课程 · ${now.getMonth() + 1}月${now.getDate()}日 ${DAY_NAMES[todayDay]}`;

  const list = allEntries()
    .filter(e => e.slot.day === todayDay && C.slotInWeek(e.slot, curWeek))
    .sort((a, b) => entryStartMin(a) - entryStartMin(b));

  const box = $('todayList');
  if (!list.length) {
    box.innerHTML = `<div class="today-empty">今天没有课，好好休息吧 ~</div>`;
  } else {
    box.innerHTML = '';
    for (const e of list) {
      const { course: c, slot: sl } = e;
      const s = currentSettings();
      let t1s, t2e;
      if (sl.customTime) {
        t1s = sl.customTime.start; t2e = sl.customTime.end;
      } else {
        const t1 = s.times[Math.min(sl.start, s.classNum) - 1] || { start: '--:--' };
        const t2 = s.times[Math.min(sl.start + sl.step - 1, s.classNum) - 1] || { end: '--:--' };
        t1s = t1.start; t2e = t2.end;
      }
      const isPast = nowMin > toMin(t2e);
      const isNow = nowMin >= toMin(t1s) && nowMin <= toMin(t2e);
      const item = document.createElement('div');
      item.className = `today-item${isPast ? ' past' : ''}${isNow ? ' current' : ''}`;
      item.innerHTML = `
        <span class="t-time">${t1s}<br>${t2e}</span>
        <div>
          <div class="t-name">${escapeHtml(c.name)}</div>
          <div class="t-sub">${escapeHtml([sl.room, sl.teach && sl.teach + ' 老师'].filter(Boolean).join(' · ') || '—')}</div>
        </div>
        <span class="t-state${isNow ? ' now' : ''}">${isNow ? '● 进行中' : (isPast ? '已结束' : '未开始')}</span>
      `;
      box.appendChild(item);
    }
  }
  openModal('todayModal');
}

// ---------- 分享与导入导出（文件 / QR / 口令，全离线） ----------
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${W.pad2(d.getMonth() + 1)}${W.pad2(d.getDate())}`;
}
function fileNameSafe(name) { return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'schedule'; }

function toggleMenu(id) {
  const menu = $(id);
  const willOpen = menu.hidden;
  document.querySelectorAll('.dropdown').forEach(d => { d.hidden = true; });
  menu.hidden = !willOpen;
}

async function doExportAction(act) {
  const sch = currentSchedule();
  const base = fileNameSafe(sch.name);
  let where = null;
  if (act === 'share') {
    // 分享当前课表 → 选择分享方式（口令 / JSON / CSV / ICS）
    openModal('shareChoiceModal');
    return;
  }
  if (act === 'backup-all') {
    where = await Ports.share.send(Bk.serialize(state), `wakeup-backup-${dateStamp()}.json`);
  } else if (act === 'share-json') {
    where = await Ports.share.send(Bk.serializeShare(sch), `wakeup-share-${base}.json`);
  } else if (act === 'share-csv') {
    where = await Ports.share.send(Csv.toCsv(sch), `wakeup-${base}-${dateStamp()}.csv`);
  } else if (act === 'share-ics') {
    where = await Ports.share.send(Ics.toIcs(sch), `wakeup-${base}-${dateStamp()}.ics`);
  } else if (act === 'share-qr') {
    closeModal('shareChoiceModal');
    await openQrModal();
    return;
  }
  if (where) showToast(`已导出到 ${where}`);
}

async function openQrModal() {
  const r = await Share.encodeShare(currentSchedule());
  if (r.error) { showToast(r.error); return; }
  $('shareCode').value = r.code;
  const box = $('qrBox');
  box.innerHTML = '';
  if (typeof qrcode === 'undefined') {
    box.innerHTML = '<div class="qr-too-big">二维码组件未加载（vendor/qrcode-generator.js）<br>仍可使用下方口令或文件方式分享</div>';
    $('qrTip').textContent = '';
  } else {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(r.code);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      $('qrTip').textContent = '对方扫码后按提示操作，或将口令粘贴到「导入 ▾ → 从文本口令导入」';
    } catch (e) {
      box.innerHTML = '<div class="qr-too-big">口令过长，无法生成二维码<br>请使用下方口令或文件方式分享</div>';
      $('qrTip').textContent = '';
    }
  }
  openModal('qrModal');
}

let pendingImportState = null;

// ---------- 摄像头扫码（BarcodeDetector + getUserMedia） ----------
let scanStream = null, scanTimer = null;

function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
}

async function startScan() {
  if (!('BarcodeDetector' in window)) {
    showToast('当前环境不支持扫码识别，请手动粘贴口令');
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    showToast('无法访问摄像头，请检查权限或手动粘贴口令');
    return;
  }
  const video = $('scanVideo');
  video.srcObject = scanStream;
  $('scanHint').textContent = '将二维码对准取景框';
  openModal('scanModal');
  const detector = new window.BarcodeDetector();
  scanTimer = setInterval(async () => {
    if (video.readyState < 2) return;
    try {
      const codes = await detector.detect(video);
      const hit = codes.find(c => /^WU[01]:/.test(c.rawValue || ''));
      if (hit) {
        $('codeInput').value = hit.rawValue;
        stopScan();
        closeModal('scanModal');
        showToast('已识别口令，请点击导入');
      }
    } catch (e) { /* 单帧失败忽略 */ }
  }, 350);
}

async function doImportAction(act) {
  if (act === 'code') {
    $('codeInput').value = '';
    openModal('codeImportModal');
    return;
  }
  const r = await Ports.share.receive();
  if (!r) return;
  if (r.error) { showToast('导入失败：无法读取文件'); return; }
  await handleImportText(r.text, r.name);
}

async function handleImportText(text, name) {
  // CSV → 课程导入当前课表
  if (/\.csv$/i.test(name || '')) {
    const r = Csv.parseCsv(text);
    if (r.error) { showToast('导入失败：' + r.error); return; }
    const sch = currentSchedule();
    for (const c of r.courses) sch.courses.push(c);
    touchSchedule();
    await persist();
    render();
    showToast(`已导入 ${r.courses.length} 门课程` + (r.skipped ? `（跳过 ${r.skipped} 行无效数据）` : ''));
    return;
  }

  const parsed = Bk.parseAuto(text);
  if (parsed.error) { showToast('导入失败：' + parsed.error); return; }
  if (parsed.kind === 'share') {
    importAsNewSchedules([parsed.schedule]);
    return;
  }
  // 完整备份 → 选择导入方式
  const n = parsed.state.schedules.reduce((a, s) => a + s.courses.length, 0);
  $('importSummary').innerHTML =
    `<b>${escapeHtml(name || '备份文件')}</b><br>${parsed.state.schedules.length} 个课表 / ${n} 门课程`;
  pendingImportState = parsed.state;
  openModal('importChoiceModal');
}

function importAsNewSchedules(list) {
  const existing = new Set(state.schedules.map(s => s.name));
  let first = null;
  for (const raw of list) {
    const sch = M.normalizeSchedule(JSON.parse(JSON.stringify(raw)));
    sch.id = M.newId('sch');
    if (existing.has(sch.name)) sch.name += '(导入)';
    existing.add(sch.name);
    state.schedules.push(sch);
    if (!first) first = sch.id;
  }
  state.currentScheduleId = first;
  state.updatedAt = Date.now();
  viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, calcCurrentWeek()));
  persist();
  updateWeekUI();
  render();
  showToast(`已导入 ${list.length} 个课表`);
}

async function confirmImportChoice() {
  if (!pendingImportState) return;
  const mode = (document.querySelector('input[name="importMode"]:checked') || {}).value || 'new';
  closeModal('importChoiceModal');
  const incoming = pendingImportState;
  pendingImportState = null;
  if (mode === 'merge') {
    state = Mrg.mergeState(state, incoming);
    await persist();
    updateWeekUI();
    render();
    showToast('合并导入完成（双方较新的修改均已保留）');
  } else {
    importAsNewSchedules(incoming.schedules);
  }
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 周切换：箭头 / 滑杆 / 键盘 / 触摸板
  $('prevWeek').onclick = (e) => { e.stopPropagation(); setViewWeek(viewWeek - 1); };
  $('nextWeek').onclick = (e) => { e.stopPropagation(); setViewWeek(viewWeek + 1); };

  // 顶栏：周标题 → 左上角小菜单（回到本周）；三点按钮 → 周数/课表/功能面板
  $('tbWeekBtn').onclick = (e) => { if (!e.target.closest('.wk-arrow')) toggleMenu('weekQuickMenu'); };
  $('weekQuickMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    $('weekQuickMenu').hidden = true;
    if (b.dataset.act === 'backtoday') setViewWeek(Math.max(1, calcCurrentWeek()));
  });
  $('btnMore').onclick = () => { updateWeekUI(); openModal('weekPanel'); };
  $('wpSlider').oninput = (e) => setViewWeek(Number(e.target.value));

  // 添加课程
  $('btnAdd').onclick = () => openCourseModal('add', null, null);

  // 周数面板功能宫格（保留 4 槽位，当前仅右侧两项）
  $('btnPanelTheme').onclick = () => toggleTheme();
  $('btnPanelSettings').onclick = () => openSettings();

  // 导入/导出菜单
  $('btnExport').onclick = (e) => { e.stopPropagation(); toggleMenu('exportMenu'); };
  $('btnImport').onclick = (e) => { e.stopPropagation(); toggleMenu('importMenu'); };
  $('exportMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    $('exportMenu').hidden = true;
    doExportAction(b.dataset.act);
  });
  // 分享方式选择弹窗
  $('shareChoiceModal').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-share]');
    if (!b) return;
    doExportAction('share-' + b.dataset.share);
  });
  // 摄像头扫码入口
  $('btnScanCode').onclick = () => startScan();
  // 扫码弹窗关闭（含 Escape/遮罩）时停止摄像头
  new MutationObserver(() => {
    if ($('scanModal').hidden) stopScan();
  }).observe($('scanModal'), { attributes: true, attributeFilter: ['hidden'] });
  $('importMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    $('importMenu').hidden = true;
    doImportAction(b.dataset.act);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) {
      document.querySelectorAll('.dropdown').forEach(d => { d.hidden = true; });
    }
  });

  // QR / 口令 / 导入选择
  $('btnCopyCode').onclick = async () => {
    const code = $('shareCode').value;
    if (!code) return;
    try { await navigator.clipboard.writeText(code); }
    catch (e) { $('shareCode').select(); document.execCommand('copy'); }
    showToast('口令已复制');
  };
  $('btnSaveShareFile').onclick = async () => {
    const sch = currentSchedule();
    const where = await Ports.share.send(Bk.serializeShare(sch), `wakeup-share-${fileNameSafe(sch.name)}.json`);
    if (where) showToast(`已导出到 ${where}`);
  };
  $('btnImportCode').onclick = async () => {
    const code = $('codeInput').value.trim();
    if (!code) { showToast('请粘贴口令'); return; }
    const r = await Share.decodeShare(code);
    if (r.error) { showToast('导入失败：' + r.error); return; }
    closeModal('codeImportModal');
    importAsNewSchedules([r.schedule]);
  };
  $('btnConfirmImport').onclick = confirmImportChoice;

  // 周次选择弹窗
  $('wdModeBtn').onclick = () => { wdCtx.mode = wdCtx.mode === 'date' ? 'week' : 'date'; renderWeekDlg(); };
  const wdPickAll = (odd) => {
    wdCtx.odd = odd;
    wdCtx.start = 1;
    wdCtx.end = currentSettings().totalWeeks;
    wdCtx.picking = false;
    renderWeekDlg();
  };
  $('wgAll').onclick = () => wdPickAll(0);
  $('wgOdd').onclick = () => wdPickAll(1);
  $('wgEven').onclick = () => wdPickAll(2);
  $('wdCancel').onclick = () => { wdCtx = null; closeModal('weekDlg'); };
  $('wdOk').onclick = () => {
    if (!wdCtx) return;
    const card = wdCtx.card;
    if (wdCtx.mode === 'date') {
      const df = $('wdDf').value, dt = $('wdDt').value;
      if (!df || !dt) { showToast('请填写起止日期'); return; }
      if (df > dt) { showToast('开始日期需早于结束日期'); return; }
      card.dataset.mode = 'date';
      card.querySelector('.sf-df').value = df;
      card.querySelector('.sf-dt').value = dt;
    } else {
      card.dataset.mode = 'week';
      card.querySelector('.sf-sw').value = wdCtx.start;
      card.querySelector('.sf-ew').value = wdCtx.end;
      card.querySelector('.sf-odd').value = wdCtx.odd;
    }
    updateSlotLabels(card);
    wdCtx = null;
    closeModal('weekDlg');
  };

  // 时间选择弹窗
  $('tpCancel').onclick = () => { tpCtx = null; closeModal('timeDlg'); };
  $('tpOk').onclick = () => {
    if (!tpCtx) return;
    const card = tpCtx.card;
    card.querySelector('.sf-day').value = tpCtx.day;
    card.querySelector('.sf-start').value = tpCtx.start;
    card.querySelector('.sf-end').value = tpCtx.end;
    updateSlotLabels(card);
    tpCtx = null;
    closeModal('timeDlg');
  };

  // 课程表单杂项
  // 颜色选择：按钮（颜色即时反映）→ 色板（库 10 色 + 自定义）→ SV 取色器
  $('btnToggleColor').onclick = () => {
    const pick = $('colorPick');
    if (pick.hidden) { buildColorPick(); pick.hidden = false; }
    else { pick.hidden = true; $('customColorRow').hidden = true; }
  };
  bindPickerDrag($('cpSv'), (x, y) => {
    cpCtx.s = x; cpCtx.v = 1 - y;
    renderCustomPicker();
    applyPickerColor();
  });
  bindPickerDrag($('cpHue'), (x) => {
    cpCtx.h = Math.round(x * 360) % 360;
    renderCustomPicker();
    applyPickerColor();
  });
  $('ccHex').oninput = (e) => {
    const v = e.target.value.trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) {
      pickedColor = '#' + v.toLowerCase();
      Object.assign(cpCtx, hexToHsv(pickedColor));
      renderCustomPicker();
      $('btnToggleColor').style.color = pickedColor;
      $('ccPreview').style.background = pickedColor;
      buildColorPick();
    }
  };
  $('btnCpCancel').onclick = () => {
    if (cpCtx.prev !== null) pickedColor = cpCtx.prev; // 恢复打开前颜色
    $('customColorRow').hidden = true;
    updateColorUI();
    buildColorPick();
  };
  $('f_name').addEventListener('input', () => {
    if (pickedColor === -1) updateColorUI(); // 自动配色随课程名实时变
  });
  $('btnCancelCourse').onclick = () => closeModal('courseModal');

  $('btnEditCourse').onclick = () => {
    if (courseModalMode === 'view') {
      const c = findCourse(editingCourseId);
      if (c) openCourseModal('edit', c);
    } else {
      saveCourseFromForm();
    }
  };
  $('btnDeleteCourse').onclick = onDeleteClick;
  bindDeleteScopeButtons();
  bindSlotListEvents();

  $('btnAddSlot').onclick = () => {
    const box = $('slotList');
    const last = box.lastElementChild;
    const sl = last ? readSlotFromCard(last) : M.normalizeSlot({});
    if (sl.err) { $('formTip').textContent = sl.err; return; }
    box.appendChild(slotCard(sl.slot || sl, box.children.length));
    renumberSlots();
    box.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  $('btnSaveSettings').onclick = saveSettings;
  $('s_alpha').oninput = (e) => $('alphaVal').textContent = e.target.value + '%';
  $('s_itemHeight').oninput = (e) => $('heightVal').textContent = e.target.value + 'px';
  $('s_showColBg').onchange = (e) => {
    $('rowColBgAlpha').hidden = !e.target.checked;
  };
  $('s_colBgAlpha').oninput = (e) => $('colBgAlphaVal').textContent = e.target.value + '%';
  $('s_sameLen').onchange = (e) => {
    // 只切换结束时间可编辑状态，不重建表格——已同步的时间保留供修改
    $('s_lessonLen').disabled = !e.target.checked;
    $('btnApplyLen').disabled = !e.target.checked;
    document.querySelectorAll('#timeTable input[data-field="end"]').forEach(inp => {
      inp.disabled = e.target.checked;
    });
  };
  const syncSundayFirstRow = () => {
    $('rowSundayFirst').hidden = !$('s_showSunday').checked;
  };
  $('s_showSaturday').onchange = syncSundayFirstRow;
  $('s_showSunday').onchange = syncSundayFirstRow;
  $('s_showOtherWeek').onchange = (e) => {
    $('rowOtherWeekAlpha').hidden = !e.target.checked;
  };
  $('s_owAlpha').oninput = (e) => $('owAlphaVal').textContent = e.target.value + '%';
  $('s_headerFs').oninput = (e) => $('headerFsVal').textContent = e.target.value + 'px';
  $('s_textFs').oninput = (e) => $('textFsVal').textContent = e.target.value + 'px';
  $('s_radius').oninput = (e) => $('radiusVal').textContent = e.target.value + 'px';
  $('btnApplyLen').onclick = () => {
    const len = Number($('s_lessonLen').value) || 45;
    document.querySelectorAll('#timeTable .time-row').forEach(row => {
      const startInp = row.querySelector('input[data-field="start"]');
      const endInp = row.querySelector('input[data-field="end"]');
      if (startInp && startInp.value) endInp.value = addMinutes(startInp.value, len);
    });
    showToast('已按统一时长更新全部下课时间');
  };

  // 关闭弹窗
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.hidden = true; });
  });

  // 键盘：← → 切周，Home 回本周，N 新增
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing) return;
    const anyModal = document.querySelector('.modal-overlay:not([hidden])');
    if (anyModal) {
      if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.hidden = true);
      return;
    }
    if (e.key === 'ArrowLeft') setViewWeek(viewWeek - 1);
    else if (e.key === 'ArrowRight') setViewWeek(viewWeek + 1);
    else if (e.key === 'Home') setViewWeek(Math.max(1, calcCurrentWeek()));
    else if (e.key === 'n' || e.key === 'N') openCourseModal('add', null, null);
  });

  // 触摸板横向滑动切周
  $('scheduleWrap').addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) {
      e.preventDefault();
      setViewWeek(viewWeek + (e.deltaX > 0 ? 1 : -1));
    }
  }, { passive: false });

  // 时间表编辑：统一时长模式下改上课时间自动算下课时间
  $('timeTable').addEventListener('change', (e) => {
    const inp = e.target;
    if (inp.tagName !== 'INPUT' || !inp.dataset.ti) return;
    if ($('s_sameLen').checked && inp.dataset.field === 'start') {
      const len = Number($('s_lessonLen').value) || 45;
      const endInp = inp.parentElement.querySelector('input[data-field="end"]');
      if (endInp && inp.value) endInp.value = addMinutes(inp.value, len);
    }
  });

  bindScheduleManager();
}

// 从卡片读取单个 slot（btnAddSlot 复制上一时间段用），失败返回 {err}
function readSlotFromCard(card) {
  const s = currentSettings();
  const start = Number(card.querySelector('.sf-start').value);
  const end = Number(card.querySelector('.sf-end').value);
  if (!start || !end || start > end) return { err: '上一时间段节次不合法，无法复制' };
  let sw = Number(card.querySelector('.sf-sw').value);
  let ew = Number(card.querySelector('.sf-ew').value);
  if (!sw || !ew || sw > ew) { sw = 1; ew = s.totalWeeks; }
  let customTime = null;
  if (card.querySelector('.sf-custom').checked) {
    const cts = card.querySelector('.sf-cts').value;
    const cte = card.querySelector('.sf-cte').value;
    if (cts && cte && cts < cte) customTime = { start: cts, end: cte };
  }
  return M.normalizeSlot({
    day: Number(card.querySelector('.sf-day').value),
    start, step: end - start + 1, startWeek: sw, endWeek: ew,
    isOdd: Number(card.querySelector('.sf-odd').value),
    room: card.querySelector('.sf-room').value.trim(),
    teach: card.querySelector('.sf-teach').value.trim(),
    customTime
  });
}

// ---------- 启动 ----------
async function init() {
  if (!Ports.isElectron) $('modeBadge').hidden = false;

  const text = await Ports.storage.load();
  let raw = null, wasV1 = false;
  if (text) { try { raw = JSON.parse(text); } catch (e) { raw = null; } }
  if (raw && !Array.isArray(raw.schedules)) wasV1 = true; // v1 或未知旧格式

  state = M.migrate(raw);
  if (wasV1) await persist(); // 旧格式即刻落盘升级为 v2

  document.documentElement.dataset.theme = state.prefs.theme;
  viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, calcCurrentWeek()));

  updateThemeToggleLabel();
  bindEvents();
  render();

  if (wasV1) showToast('数据已自动升级到 v2 格式：支持多时间段与多课表', 3200);
  else if (currentSchedule().courses.length === 0) {
    showToast('欢迎使用 WakeUp 课程表本地版！请先到「更多 → 课表设置」填写学期开始日期', 3500);
  }
}

init();
