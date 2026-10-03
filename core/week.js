/*!
 * WakeUp 课程表本地版 · 领域内核：周次与日期计算（纯函数，零平台依赖）
 * UMD：浏览器挂 window.WakeupWeek；Node 环境 module.exports 供单元测试
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WakeupWeek = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 24 * 3600 * 1000;
  const WEEK_MS = 7 * DAY_MS;

  const pad2 = (n) => String(n).padStart(2, '0');

  function parseDate(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function fmtYmd(date) { // iCal 用：YYYYMMDD
    return '' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate());
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function today() { return parseDate(fmtDate(new Date())); }

  // 归一化：Date 或 'YYYY-MM-DD' 字符串 → Date
  function toDate(d) { return d instanceof Date ? d : parseDate(String(d)); }

  // 周一=0 ... 周日=6
  function mondayIndex(date) { return (date.getDay() + 6) % 7; }

  // 学期开始日期所在周的周一（周次锚点）
  function weekAnchor(termStart) {
    const d = parseDate(termStart);
    return addDays(d, -mondayIndex(d));
  }

  // 还原原版 countWeek：天数差/7 + 1（结果可能 ≤0 或超出学期，由调用方收敛）
  function calcCurrentWeek(termStart, now) {
    const t = now ? toDate(now) : today();
    const diff = Math.floor((t - weekAnchor(termStart)) / WEEK_MS);
    return diff + 1;
  }

  function weekStartDate(termStart, w) { return addDays(weekAnchor(termStart), (w - 1) * 7); }
  function dayDate(termStart, w, day) { return addDays(weekStartDate(termStart, w), day - 1); }

  function weekOfDate(termStart, date) {
    return Math.floor((toDate(date) - weekAnchor(termStart)) / WEEK_MS) + 1;
  }

  // 日期模式（原版特色功能）：起止日期 → 周次范围，存储仍为周次
  function weeksFromDates(termStart, startDate, endDate) {
    let a = weekOfDate(termStart, startDate);
    let b = weekOfDate(termStart, endDate);
    if (a > b) { const t = a; a = b; b = t; } // 容错：日期反填自动交换
    return { startWeek: Math.max(1, a), endWeek: Math.max(1, b) };
  }

  // ---- 时间工具（HH:MM）----
  function toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  }
  function minutesToTime(m) {
    m = ((m % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }
  function addMinutes(hhmm, min) { return minutesToTime(toMinutes(hhmm) + min); }

  return {
    pad2, parseDate, fmtDate, fmtYmd, addDays, today, mondayIndex,
    weekAnchor, calcCurrentWeek, weekStartDate, dayDate, weekOfDate, weeksFromDates,
    toMinutes, minutesToTime, addMinutes
  };
});
