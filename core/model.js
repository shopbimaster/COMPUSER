/*!
 * CampUser 课程表模块 · 领域内核：数据模型 v2（纯函数，零平台依赖）
 *
 * 数据格式 campuser-schedule/2（同步就绪）：
 *   AppState   { format, device, updatedAt, prefs, currentScheduleId, schedules[] }
 *   Schedule   { id, name, updatedAt, settings, courses[], tombstones{} }   ← 多课表，配置独立
 *   Course     { id, updatedAt, name, color, credit, note, timeSlots[] }    ← 基础信息 + 多时间段
 *   TimeSlot   { id, day, start, step, weeks, startWeek, endWeek, isOdd, room, teach, customTime }
 *              weeks = '0'/'1' 位串（index 0 = 第 1 周），任意周集合的唯一真源；
 *              startWeek/endWeek/isOdd 为派生兼容字段（区间 = 选中 min..max，isOdd = 区间内纯奇/偶时为 1/2）
 *
 * 还原原版 v3.x+ 的"课程基础信息/课程时间段"两层模型：
 * 同一门课多个时间段（不同教室/周次/自定义时间）一次录入。
 * v1（平铺单时间块）由 migrate() 自动升级。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampuserModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 'campuser-schedule/2';

  // 与原版一致的默认时间表（苏大 11 节 + 扩展到 16 节占位）
  const DEFAULT_TIMES = [
    ['08:00', '08:50'], ['09:00', '09:50'], ['10:10', '11:00'], ['11:10', '12:00'],
    ['13:30', '14:20'], ['14:30', '15:20'], ['15:40', '16:30'], ['16:40', '17:30'],
    ['18:30', '19:20'], ['19:30', '20:20'], ['20:30', '21:20'], ['21:30', '22:20'],
    ['22:30', '23:20'], ['23:30', '00:20'], ['00:30', '01:20'], ['01:30', '02:20']
  ];

  const DEFAULT_SETTINGS = {
    termStart: null,        // 学期开始日期（默认取本周一）
    totalWeeks: 20,
    classNum: 11,
    itemHeight: 56,         // 原版默认 56dp
    alpha: 100,             // 新版风格：实色课程块（可调半透明）
    showOtherWeek: true,
    otherWeekAlpha: 50,     // 非本周课程不透明度 10-100
    showWeekend: true,      // 兼容旧字段：关闭 → showSaturday/showSunday 均 false
    showSaturday: true,     // 显示周六列
    showSunday: true,       // 显示周日列
    showSchName: true,      // 课表上方居中显示课表名
    showWeekTitle: true,    // 顶栏显示周序数
    headerTextSize: 13,     // 表头星期文字大小 10-16
    showColBg: true,        // 日列衬底（仿 v1.1：整列铺卡片色，列间缝隙形成分隔）
    colBgAlpha: 100,        // 衬底不透明度 10-100
    sundayFirst: false,
    sameLen: false,         // 每节课时长相同
    courseTextSize: 12,     // 格子内课程文字大小 9-16
    cornerRadius: 7,        // 格子圆角 0-16
    courseGap: 1.5,         // 课程格子边距（列宽百分比 0-10）：课程与列衬底、课程之间的统一间距
    textHCenter: false,     // 格子文字水平居中
    textVCenter: false,     // 格子文字垂直居中
    showTimeInGrid: true,   // 在格子内显示上课节次
    showTeachInGrid: true,  // 在格子内显示教师
    showNoteInGrid: false,  // 在格子内显示备注（预留接口，暂未生效）
    gridLines: false,       // 显示网格辅助线（预留接口，暂未生效）
    times: null
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.classNum = clamp(Number(s.classNum) || 11, 8, 16);
    s.totalWeeks = clamp(Number(s.totalWeeks) || 20, 1, 40);
    s.itemHeight = clamp(Number(s.itemHeight) || 56, 40, 90);
    s.alpha = clamp(Number(s.alpha) || 100, 10, 100);
    s.showOtherWeek = s.showOtherWeek !== false && s.showOtherWeek !== 'false';
    s.otherWeekAlpha = clamp(Number(s.otherWeekAlpha) || 50, 10, 100);
    s.showWeekend = s.showWeekend !== false && s.showWeekend !== 'false';
    // 旧版仅有 showWeekend 总开关 → 迁移为周六/周日独立开关
    const weekendOff = !s.showWeekend && raw && raw.showSaturday === undefined;
    s.showSaturday = weekendOff ? false : (s.showSaturday !== false && s.showSaturday !== 'false');
    s.showSunday = weekendOff ? false : (s.showSunday !== false && s.showSunday !== 'false');
    s.headerTextSize = clamp(Number(s.headerTextSize) || 13, 10, 16);
    s.showSchName = s.showSchName !== false && s.showSchName !== 'false';
    s.showWeekTitle = s.showWeekTitle !== false && s.showWeekTitle !== 'false';
    s.showColBg = s.showColBg !== false && s.showColBg !== 'false';
    s.colBgAlpha = clamp(Number(s.colBgAlpha) || 100, 10, 100);
    s.sundayFirst = !!s.sundayFirst;
    s.courseTextSize = clamp(Number(s.courseTextSize) || 12, 9, 16);
    s.cornerRadius = clamp(Number(s.cornerRadius) || 7, 0, 16);
    // 0 是合法值（无间距），不能走 `|| 默认` 的短路写法
    const cg = Number(s.courseGap);
    s.courseGap = isNaN(cg) ? DEFAULT_SETTINGS.courseGap : clamp(cg, 0, 10);
    s.textHCenter = !!s.textHCenter;
    s.textVCenter = !!s.textVCenter;
    s.showTimeInGrid = s.showTimeInGrid !== false && s.showTimeInGrid !== 'false';
    s.showTeachInGrid = s.showTeachInGrid !== false && s.showTeachInGrid !== 'false';
    s.showNoteInGrid = !!s.showNoteInGrid;
    s.gridLines = !!s.gridLines;
    if (!s.termStart || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.termStart))) {
      const t = new Date();
      t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); // 本周一
      s.termStart = t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
    } else {
      s.termStart = String(s.termStart);
    }
    if (!Array.isArray(s.times)) s.times = [];
    for (let i = 0; i < s.classNum; i++) {
      if (!s.times[i]) s.times[i] = { start: DEFAULT_TIMES[i][0], end: DEFAULT_TIMES[i][1] };
    }
    s.times = s.times.slice(0, s.classNum).map(t => ({
      start: TIME_RE.test(t.start) ? t.start : DEFAULT_TIMES[0][0],
      end: TIME_RE.test(t.end) ? t.end : DEFAULT_TIMES[0][1]
    }));
    return s;
  }

  // ---- 周次位串工具（weeks 唯一真源，startWeek/endWeek/isOdd 为派生兼容字段） ----
  // 由区间+奇偶展开位串（长度 = endWeek，其后周次隐含为 0）
  function expandWeeks(sw, ew, odd) {
    let s = '';
    for (let w = 1; w <= ew; w++) {
      s += (w >= sw && (odd === 0 || (odd === 1 && w % 2 === 1) || (odd === 2 && w % 2 === 0))) ? '1' : '0';
    }
    return s;
  }

  // 由位串派生兼容字段：区间 = 选中 min..max；区间内恰好全为奇/偶周 → isOdd 1/2
  function deriveFromWeeks(weeks) {
    const first = weeks.indexOf('1');
    if (first < 0) return { startWeek: 1, endWeek: 1, isOdd: 0 };
    const sw = first + 1, ew = weeks.lastIndexOf('1') + 1;
    let pureOdd = true, pureEven = true;
    for (let w = sw; w <= ew; w++) {
      const on = weeks.charAt(w - 1) === '1';
      if (on !== (w % 2 === 1)) pureOdd = false;
      if (on !== (w % 2 === 0)) pureEven = false;
      if (!pureOdd && !pureEven) break;
    }
    return { startWeek: sw, endWeek: ew, isOdd: pureOdd ? 1 : (pureEven ? 2 : 0) };
  }

  // 位串 → 人读标签："第1-3、6-8周"；空集合返回 ''
  function weeksLabel(weeks) {
    if (typeof weeks !== 'string' || !weeks.includes('1')) return '';
    const segs = [];
    let s = -1;
    for (let i = 0; i <= weeks.length; i++) {
      const on = i < weeks.length && weeks.charAt(i) === '1';
      if (on && s < 0) s = i;
      else if (!on && s >= 0) { segs.push(s + 1 === i ? String(i) : (s + 1) + '-' + i); s = -1; }
    }
    return '第' + segs.join('、') + '周';
  }

  function normalizeSlot(raw) {
    const r = raw || {};
    const ct = r.customTime || null;
    // weeks 位串为真源；无效（非 01 串/全 0）时回退由区间+奇偶展开
    let weeks = null;
    if (typeof r.weeks === 'string' && /^[01]+$/.test(r.weeks) && r.weeks.includes('1')) {
      weeks = r.weeks;
    } else {
      const sw0 = Math.max(1, Number(r.startWeek) || 1);
      const ew0 = Math.max(sw0, Number(r.endWeek) || sw0);
      const odd0 = [0, 1, 2].includes(Number(r.isOdd)) ? Number(r.isOdd) : 0;
      weeks = expandWeeks(sw0, ew0, odd0);
    }
    const d = deriveFromWeeks(weeks);
    return {
      id: r.id || newId('ts'),
      day: clamp(Number(r.day) || 1, 1, 7),
      start: Math.max(1, Number(r.start) || 1),
      step: Math.max(1, Number(r.step) || 1),
      weeks,
      startWeek: d.startWeek,
      endWeek: d.endWeek,
      isOdd: d.isOdd,
      room: String(r.room || '').trim(),
      teach: String(r.teach || '').trim(),
      customTime: (ct && TIME_RE.test(ct.start) && TIME_RE.test(ct.end)) ? { start: ct.start, end: ct.end } : null
    };
  }

  // color: -1 自动（随机池，按课程名首字 hash），0-9 手动库色，'#rrggbb' 自定义色
  function normalizeColor(v) {
    if (v === undefined || v === null || v === '') return -1;
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
      const n = Number(t);
      if (isNaN(n) || n < 0) return -1;
      return n % 10;
    }
    const n = Number(v);
    if (isNaN(n) || n < 0) return -1;
    return n % 10;
  }

  function normalizeCourse(raw) {
    const r = raw || {};
    const slots = Array.isArray(r.timeSlots) ? r.timeSlots.filter(Boolean) : [];
    return {
      id: r.id != null ? String(r.id) : newId('c'),
      updatedAt: Number(r.updatedAt) || 0,
      name: String(r.name || '').trim(),
      color: normalizeColor(r.color),
      credit: (r.credit === undefined || r.credit === null || r.credit === '') ? null : Math.max(0, Number(r.credit) || 0),
      note: String(r.note || '').trim(),
      timeSlots: (slots.length ? slots : [{}]).map(normalizeSlot)
    };
  }

  function normalizeSchedule(raw) {
    const r = raw || {};
    return {
      id: r.id != null ? String(r.id) : newId('sch'),
      name: (String(r.name || '').trim().slice(0, 30)) || '我的课表',
      updatedAt: Number(r.updatedAt) || 0,
      settings: normalizeSettings(r.settings),
      courses: Array.isArray(r.courses) ? r.courses.map(normalizeCourse) : [],
      tombstones: (r.tombstones && typeof r.tombstones === 'object' && !Array.isArray(r.tombstones)) ? r.tombstones : {}
    };
  }

  function normalizeState(raw) {
    const r = raw || {};
    const schedules = (Array.isArray(r.schedules) && r.schedules.length)
      ? r.schedules.map(normalizeSchedule)
      : [normalizeSchedule(null)];
    const st = {
      format: FORMAT,
      device: r.device || newId('d'),
      updatedAt: Number(r.updatedAt) || 0,
      prefs: {
        theme: (r.prefs && (r.prefs.theme === 'dark' || r.prefs.theme === 'light')) ? r.prefs.theme : 'light'
      },
      currentScheduleId: r.currentScheduleId != null ? String(r.currentScheduleId) : null,
      schedules
    };
    if (!st.schedules.find(s => s.id === st.currentScheduleId)) st.currentScheduleId = st.schedules[0].id;
    return st;
  }

  // v1 平铺课程 → v2 课程（单时间段）
  function v1ToCourse(c) {
    const r = c || {};
    return normalizeCourse({
      id: r.id != null ? String(r.id) : undefined,
      name: r.name, color: r.color, updatedAt: 0,
      timeSlots: [{
        day: r.day, start: r.start, step: r.step,
        startWeek: r.startWeek, endWeek: r.endWeek, isOdd: r.isOdd,
        room: r.room, teach: r.teach
      }]
    });
  }

  // 迁移入口：v1 {courses, settings} / v2 / 垃圾数据 → 规范 v2 状态
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return normalizeState(null);
    if (Array.isArray(raw.schedules)) return normalizeState(raw);
    if (Array.isArray(raw.courses)) {
      const sch = {
        id: newId('sch'),
        name: '我的课表',
        updatedAt: Date.now(),
        settings: normalizeSettings(raw.settings),
        courses: raw.courses.map(v1ToCourse),
        tombstones: {}
      };
      return normalizeState({ schedules: [sch] });
    }
    return normalizeState(null);
  }

  return {
    FORMAT, DEFAULT_SETTINGS, DEFAULT_TIMES,
    newId, normalizeSettings, normalizeSlot, normalizeCourse, normalizeSchedule, normalizeState, migrate,
    expandWeeks, weeksLabel
  };
});
