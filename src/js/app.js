// ============================================================
// WakeUp 课程表 · 本地还原版 · UI 层（v2）
// 仅负责渲染与交互：领域逻辑在 core/（model/week/conflict/merge/codec），
// 平台能力经 Ports 端口注入（adapters/）。数据格式 wakeup-local/2。
// ============================================================

// ---------- 常量 ----------
const COURSE_COLORS = ['#8af28d', '#00ff9d', '#ff6200', '#e7554e', '#4695ff', '#ca71ff', '#3daff1', '#5d5dff', '#80deea', '#2f88ff'];
const DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
const ODD_NAMES = ['每周', '单周', '双周'];
const GAP = 4; // 节次间距（对应原版 marTop）

// ---------- 内核与端口 ----------
const M = WakeupModel, W = WakeupWeek, C = WakeupConflict, Mrg = WakeupMerge, Bk = WakeupBackupCodec;
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

function effectiveColorIndex(c) {
  if (typeof c.color === 'number' && c.color >= 0 && c.color <= 9) return c.color;
  const code = c.name ? c.name.charCodeAt(0) : NaN;
  return isNaN(code) ? 9 : code % 10; // 原版逻辑：课程名首字 %10
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
// 课程块样式：半透明色叠卡片底色，按混合亮度自动取黑/白文字
function courseBlockStyle(c) {
  const [r, g, b] = hexToRgb(COURSE_COLORS[effectiveColorIndex(c)]);
  const card = state.prefs.theme === 'dark' ? [42, 47, 52] : [255, 255, 255];
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
  // 原版行为：周日列无任何课程时隐藏（仅当周日排最后）
  const hasSundayCourse = currentSchedule().courses.some(c => c.timeSlots.some(t => t.day === 7));
  const visibleDays = (!s.sundayFirst && !hasSundayCourse) ? days.filter(d => d !== 7) : days;

  const grid = $('grid');
  grid.style.setProperty('--day-count', visibleDays.length);
  grid.style.setProperty('--unit', s.itemHeight + 'px');
  grid.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  corner.textContent = '节次';
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
    sec.innerHTML = `<span class="sec-no">${i}</span><span class="sec-time">${s.times[i - 1].start}</span>`;
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
  renderWeekLabel();
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

  let html = `<div class="course-name">${escapeHtml(c.name)}</div>`;
  if (sl.room) html += `<div class="course-room">@${escapeHtml(sl.room)}</div>`;
  if (sl.isOdd === 1) html += `<div class="course-tag">单周</div>`;
  if (sl.isOdd === 2) html += `<div class="course-tag">双周</div>`;
  if (sl.customTime) html += `<div class="course-tag">${sl.customTime.start}~${sl.customTime.end}</div>`;
  el.innerHTML = html;

  el.title = `${c.name} ${sl.room ? '@' + sl.room : ''} ${sl.teach ? sl.teach + ' 老师' : ''}`.trim();
  el.addEventListener('click', () => openCourseModal('view', c, sl));
  return el;
}

function renderWeekLabel() {
  const cur = calcCurrentWeek();
  const label = $('weekLabel');
  label.textContent = `第 ${viewWeek} 周`;
  label.classList.toggle('is-current', viewWeek === cur);
}

function renderTodayInfo() {
  const now = new Date();
  const wd = DAY_NAMES[now.getDay() === 0 ? 7 : now.getDay()];
  const cur = calcCurrentWeek();
  let weekTxt = `第 ${cur} 周`;
  if (cur < 1) weekTxt = '未开学';
  if (cur > currentSettings().totalWeeks) weekTxt = '学期已结束';
  $('todayInfo').textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${wd} · ${weekTxt}`;
}

function buildWeekSelect() {
  const sel = $('weekSelect');
  sel.innerHTML = '';
  for (let w = 1; w <= currentSettings().totalWeeks; w++) {
    const o = document.createElement('option');
    o.value = w;
    o.textContent = `第${w}周`;
    sel.appendChild(o);
  }
  sel.value = viewWeek;
}

function setViewWeek(w) {
  viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, w));
  $('weekSelect').value = viewWeek;
  render();
}

// ---------- 课程弹窗（详情 / 编辑 / 添加） ----------
function openCourseModal(mode, course, slot, preset = {}) {
  courseModalMode = mode;
  editingCourseId = course ? course.id : null;
  editingSlotId = slot ? slot.id : null;

  $('courseModalTitle').textContent = mode === 'add' ? '添加课程' : (mode === 'edit' ? '修改课程' : '课程详情');
  $('btnEditCourse').textContent = mode === 'edit' ? '保存修改' : (mode === 'add' ? '添加' : '修改');
  $('btnDeleteCourse').hidden = mode === 'add';
  $('btnDeleteCourse').textContent = '删除';
  $('btnDeleteCourse').classList.remove('confirm');
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
  const color = COURSE_COLORS[effectiveColorIndex(c)];
  const conflicts = C.conflictsOf(allEntries(), c.id, slot ? slot.id : null);

  const slotLines = c.timeSlots.map(sl => `
    <div class="slot-line">
      <span class="sl-when">${DAY_NAMES[sl.day]} 第${sl.start}~${sl.start + sl.step - 1}节</span>
      <span class="sl-weeks">第${sl.startWeek}~${sl.endWeek}周 · ${ODD_NAMES[sl.isOdd]}</span>
      <span class="sl-time">${slotTimeText(sl)}</span>
      ${sl.room ? `<span class="sl-room">@${escapeHtml(sl.room)}</span>` : ''}
      ${sl.teach ? `<span class="sl-teach">${escapeHtml(sl.teach)}</span>` : ''}
    </div>`).join('');

  const conflictHtml = conflicts.length ? `
    <div class="conflict-list">
      <div class="conflict-title">⚠ 存在 ${conflicts.length} 处时间冲突</div>
      ${conflicts.map(p => {
        const o = p.a.course.id === c.id ? p.b : p.a;
        const os = p.a.course.id === c.id ? p.b.slot : p.a.slot;
        return `<div class="conflict-item">与《${escapeHtml(o.name)}》${DAY_NAMES[os.day]} 第${os.start}~${os.start + os.step - 1}节 重叠</div>`;
      }).join('')}
    </div>` : '';

  $('courseDetail').innerHTML = `
    <div class="detail-title">
      <span class="detail-color" style="background:${color}"></span>
      <span class="detail-name">${escapeHtml(c.name)}</span>
      ${c.credit ? `<span class="detail-credit">${c.credit} 学分</span>` : ''}
    </div>
    ${c.note ? `<div class="detail-note">📝 ${escapeHtml(c.note)}</div>` : ''}
    <div class="detail-slots">${slotLines}</div>
    ${conflictHtml}
  `;
}

function fillCourseForm(c) {
  $('f_name').value = c.name;
  $('f_credit').value = (c.credit === null || c.credit === undefined) ? '' : c.credit;
  $('f_note').value = c.note || '';
  buildColorPick(typeof c.color === 'number' ? c.color : -1);
  renderSlotCards(c.timeSlots);
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
      <button type="button" class="icon-btn slot-remove" title="删除此时间段">×</button>
    </div>
    <div class="form-row two-col">
      <div><label>星期 <i>*</i></label>
        <select class="sf-day">${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}" ${d === sl.day ? 'selected' : ''}>${DAY_NAMES[d]}</option>`).join('')}</select>
      </div>
      <div><label>周类型</label>
        <select class="sf-odd">${[0, 1, 2].map(v => `<option value="${v}" ${v === sl.isOdd ? 'selected' : ''}>${ODD_NAMES[v]}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row two-col">
      <div><label>节次 <i>*</i></label>
        <div class="range-pick">
          <select class="sf-start">${sectionOptions(Math.min(sl.start, s.classNum))}</select>
          <span>~</span>
          <select class="sf-end">${sectionOptions(Math.max(1, endSec))}</select>
        </div>
      </div>
      <div><label>周次 <i>*</i></label>
        <div class="range-tabs">
          <button type="button" class="rt-btn active" data-mode="week">周次</button>
          <button type="button" class="rt-btn" data-mode="date">日期</button>
        </div>
        <div class="range-pick mode-week">
          <input type="number" class="sf-sw" min="1" max="${s.totalWeeks}" value="${sl.startWeek}">
          <span>~</span>
          <input type="number" class="sf-ew" min="1" max="${s.totalWeeks}" value="${Math.max(sl.endWeek, sl.startWeek)}">
        </div>
        <div class="range-pick mode-date" hidden>
          <input type="date" class="sf-df">
          <span>~</span>
          <input type="date" class="sf-dt">
        </div>
      </div>
    </div>
    <div class="form-row two-col">
      <div><label>教师</label><input type="text" class="sf-teach" maxlength="20" value="${escapeHtml(sl.teach)}"></div>
      <div><label>教室</label><input type="text" class="sf-room" maxlength="30" value="${escapeHtml(sl.room)}"></div>
    </div>
    <div class="form-row inline">
      <label class="switch-label"><input type="checkbox" class="sf-custom" ${sl.customTime ? 'checked' : ''}>自定义时间</label>
      <div class="range-pick ct-times" ${sl.customTime ? '' : 'hidden'}>
        <input type="time" class="sf-cts" value="${sl.customTime ? sl.customTime.start : '08:00'}">
        <span>~</span>
        <input type="time" class="sf-cte" value="${sl.customTime ? sl.customTime.end : '09:40'}">
      </div>
    </div>
  `;
  return card;
}

// 时间段列表事件（委托）
function bindSlotListEvents() {
  const box = $('slotList');
  box.addEventListener('click', (e) => {
    const rt = e.target.closest('.rt-btn');
    if (rt) {
      const card = rt.closest('.slot-card');
      card.dataset.mode = rt.dataset.mode;
      card.querySelectorAll('.rt-btn').forEach(b => b.classList.toggle('active', b === rt));
      card.querySelector('.mode-week').hidden = rt.dataset.mode !== 'week';
      card.querySelector('.mode-date').hidden = rt.dataset.mode !== 'date';
      return;
    }
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
    btn.textContent = '再点一次确认删除';
    btn.classList.add('confirm');
    setTimeout(() => {
      deleteArmed = false;
      btn.textContent = '删除';
      btn.classList.remove('confirm');
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
        btn.classList.add('confirm');
        setTimeout(() => { armed = false; btn.textContent = btn.dataset.text; btn.classList.remove('confirm'); }, 3000);
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

// ---------- 颜色选择 ----------
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

// ---------- 弹窗开关 ----------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

// ---------- 课表管理（多课表） ----------
function buildScheduleSelect() {
  const sel = $('scheduleSelect');
  sel.innerHTML = '';
  for (const s of state.schedules) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  }
  sel.value = state.currentScheduleId;
}

function switchSchedule(id) {
  if (!state.schedules.find(s => s.id === id)) return;
  state.currentScheduleId = id;
  state.updatedAt = Date.now();
  persist();
  viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, calcCurrentWeek()));
  buildWeekSelect();
  render();
  renderTodayInfo();
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
  $('btnManageSchedules').onclick = openScheduleManager;
  $('scheduleSelect').onchange = (e) => switchSchedule(e.target.value);
  $('btnCreateSchedule').onclick = () => {
    const name = $('newScheduleName').value.trim();
    if (!name) { showToast('请输入新课表名称'); return; }
    const sch = M.normalizeSchedule({ name });
    state.schedules.push(sch);
    state.currentScheduleId = sch.id;
    state.updatedAt = Date.now();
    $('newScheduleName').value = '';
    persist();
    buildScheduleSelect();
    renderScheduleList();
    render();
    renderTodayInfo();
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
      buildScheduleSelect();
      renderScheduleList();
      return;
    }
    if (e.target.closest('.sch-del')) {
      if (state.schedules.length <= 1) { showToast('至少保留一个课表'); return; }
      const btn = e.target.closest('.sch-del');
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认删除?';
        setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '删除'; }, 3000);
        return;
      }
      state.schedules = state.schedules.filter(s => s.id !== id);
      if (state.currentScheduleId === id) state.currentScheduleId = state.schedules[0].id;
      state.updatedAt = Date.now();
      persist();
      buildScheduleSelect();
      renderScheduleList();
      render();
      renderTodayInfo();
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
    buildScheduleSelect();
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
  $('s_alpha').value = s.alpha;
  $('alphaVal').textContent = s.alpha + '%';
  $('s_itemHeight').value = s.itemHeight;
  $('heightVal').textContent = s.itemHeight + 'px';
  $('s_theme').value = state.prefs.theme;
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
  const s = currentSettings();
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
  const cur = currentSettings();
  const s = { ...cur };
  s.termStart = $('s_termStart').value || cur.termStart;
  s.totalWeeks = Number($('s_totalWeeks').value) || 20;
  s.classNum = Number($('s_classNum').value);
  s.alpha = Number($('s_alpha').value);
  s.itemHeight = Number($('s_itemHeight').value);
  s.showOtherWeek = $('s_showOtherWeek').checked;
  s.sundayFirst = $('s_sundayFirst').checked;
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
  state.prefs.theme = $('s_theme').value;
  document.documentElement.dataset.theme = state.prefs.theme;

  viewWeek = Math.min(sch.settings.totalWeeks, Math.max(1, viewWeek));
  if (oldTermStart !== sch.settings.termStart) {
    viewWeek = Math.min(sch.settings.totalWeeks, Math.max(1, calcCurrentWeek()));
  }
  touchSchedule();
  persist();
  buildScheduleSelect();
  buildWeekSelect();
  render();
  renderTodayInfo();
  closeModal('settingsModal');
  showToast('设置已保存');
}

// ---------- 今日课程 ----------
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

// ---------- 导入 / 导出（C4 过渡实现：备份 + 合并；C5 扩展分享/QR） ----------
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${W.pad2(d.getMonth() + 1)}${W.pad2(d.getDate())}`;
}

async function doExport() {
  const where = await Ports.share.send(Bk.serialize(state), `wakeup-backup-${dateStamp()}.json`);
  if (where) showToast(`已导出到 ${where}`);
}

async function doImport() {
  const r = await Ports.share.receive();
  if (!r) return;
  if (r.error) { showToast('导入失败：无法读取文件'); return; }
  const parsed = Bk.parseAuto(r.text);
  if (parsed.error) { showToast('导入失败：' + parsed.error); return; }

  if (parsed.kind === 'share') {
    importAsNewSchedules([parsed.schedule]);
    return;
  }
  // 完整备份 → LWW 合并（非破坏性）
  const n = parsed.state.schedules.reduce((a, s) => a + s.courses.length, 0);
  if (!confirm(`识别到备份：${parsed.state.schedules.length} 个课表 / ${n} 门课程。\n将与现有数据合并（双方较新的修改保留），继续吗？`)) return;
  state = Mrg.mergeState(state, parsed.state);
  await persist();
  buildScheduleSelect();
  buildWeekSelect();
  render();
  renderTodayInfo();
  showToast('合并导入完成');
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
  buildScheduleSelect();
  buildWeekSelect();
  render();
  renderTodayInfo();
  showToast(`已导入 ${list.length} 个课表`);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('prevWeek').onclick = () => setViewWeek(viewWeek - 1);
  $('nextWeek').onclick = () => setViewWeek(viewWeek + 1);
  $('backToday').onclick = () => setViewWeek(Math.max(1, calcCurrentWeek()));
  $('weekSelect').onchange = (e) => setViewWeek(Number(e.target.value));

  $('btnAdd').onclick = () => openCourseModal('add', null, null);
  $('fabAdd').onclick = () => openCourseModal('add', null, null);
  $('btnSettings').onclick = openSettings;
  $('btnTodayCourses').onclick = openTodayModal;
  $('btnImport').onclick = doImport;
  $('btnExport').onclick = doExport;

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
    const anyModal = ['courseModal', 'settingsModal', 'todayModal', 'scheduleModal'].some(id => !$(id).hidden);
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

  buildScheduleSelect();
  buildWeekSelect();
  bindEvents();
  render();
  renderTodayInfo();

  if (wasV1) showToast('数据已自动升级到 v2 格式：支持多时间段与多课表', 3200);
  else if (currentSchedule().courses.length === 0) {
    showToast('欢迎使用 WakeUp 课程表本地版！请先到「设置」填写学期开始日期', 3500);
  }
}

init();
