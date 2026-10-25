/*!
 * CampUser 调课模块（纯函数零平台依赖）
 * 课程拖动调课与整日调课的数据变换，全部基于 campuser-schedule/2 现有结构
 * （weeks 位串为唯一真源，startWeek/endWeek/isOdd 为派生兼容字段——任何 weeks
 * 变更后须经 syncDerived 同步派生字段，保证导出/合并语义一致）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampuserAdjust = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;

  /** 从位串摘除第 w 周（w 从 1 起），长度不变；结果无任何 '1' 时返回 '' */
  function removeWeek(bits, w) {
    const out = String(bits || '')
      .split('')
      .map((c, i) => (i === w - 1 ? '0' : c))
      .join('');
    return out.includes('1') ? out : '';
  }

  /** 第 w 周的单周位串（长度 = w，使位串覆盖到该周） */
  function bitsOf(w) {
    return '0'.repeat(Math.max(0, w - 1)) + '1';
  }

  /** 位串是否含第 w 周（越界 = 不含） */
  function hasWeek(bits, w) {
    return String(bits || '')[w - 1] === '1';
  }

  /** 依据 weeks 同步派生字段（startWeek/endWeek/isOdd）——与 model.normalizeSlot 语义一致 */
  function syncDerived(slot) {
    const ones = [];
    for (let i = 0; i < slot.weeks.length; i++) if (slot.weeks[i] === '1') ones.push(i + 1);
    slot.startWeek = ones.length ? ones[0] : 1;
    slot.endWeek = ones.length ? ones[ones.length - 1] : 1;
    const odd = ones.filter((w) => w % 2 === 1);
    slot.isOdd = ones.length === 0 ? 0 : odd.length === ones.length ? 1 : odd.length === 0 ? 2 : 0;
  }

  /** 学期第 w 周星期 d（均从 1 起）→ 'YYYY-MM-DD'（termStart 为第 1 周周一） */
  function dateOfWeekDay(termStart, w, d) {
    const base = new Date(termStart + 'T00:00:00').getTime();
    const dt = new Date(base + ((w - 1) * 7 + (d - 1)) * DAY_MS);
    // 用本地分量拼接（toISOString 走 UTC，+08:00 时区会偏移一天）
    return (
      dt.getFullYear() +
      '-' +
      String(dt.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(dt.getDate()).padStart(2, '0')
    );
  }

  /** 日期 → { w, d }；日期早于 termStart 或周次超出 totalWeeks 时返回 null */
  function weekDayOfDate(termStart, dateIso, totalWeeks) {
    const base = new Date(termStart + 'T00:00:00').getTime();
    const diff = Math.floor((new Date(dateIso + 'T00:00:00').getTime() - base) / DAY_MS);
    if (diff < 0) return null;
    const w = Math.floor(diff / 7) + 1;
    let d = diff % 7 + 1; // termStart 为周一 → diff%7: 0=周一
    if (w > totalWeeks) return null;
    return { w, d };
  }

  /** 拖动「只调这一节」：slot 摘除 week 周，剩余为空则整体移动，否则新增单周目标段。
   *  返回 true=已修改。course 为课程对象（含 timeSlots），slotIndex 为其下标。 */
  function moveSlotOneWeek(course, slotIndex, week, toDay, toStart, toStep) {
    const slot = course.timeSlots[slotIndex];
    if (!slot || !hasWeek(slot.weeks, week)) return false;
    const rest = removeWeek(slot.weeks, week);
    if (!rest) {
      // 原段仅此一周 → 整段移动到目标位置
      slot.day = toDay;
      slot.start = toStart;
      slot.step = toStep;
      slot.weeks = bitsOf(week);
      syncDerived(slot);
      return true;
    }
    slot.weeks = rest;
    syncDerived(slot);
    course.timeSlots.push({
      id: null,
      day: toDay,
      start: toStart,
      step: toStep,
      weeks: bitsOf(week),
      startWeek: week,
      endWeek: week,
      isOdd: 0,
      room: slot.room || '',
      teach: slot.teach || '',
      customTime: slot.customTime || null,
    });
    course.timeSlots.sort((a, b) => a.day - b.day || a.start - b.start);
    return true;
  }

  /** 拖动「调整所有同时间段」：整个时间段移动到目标位置 */
  function moveSlotAll(course, slotIndex, toDay, toStart, toStep) {
    const slot = course.timeSlots[slotIndex];
    if (!slot) return false;
    slot.day = toDay;
    slot.start = toStart;
    slot.step = toStep;
    return true;
  }

  /**
   * 整日调整：把「第 fromW 周 星期 fromD」的所有课移到「第 toW 周 星期 toD」。
   * 直接修改传入的 courses（原地）；返回 { moved, courses: 影响课程数 }。
   * 目标位串长度扩展到 toW；起点仅此一周的段整体搬迁。
   */
  function adjustWholeDay(courses, fromW, fromD, toW, toD) {
    let moved = 0;
    const affected = new Set();
    for (const c of courses || []) {
      if (!c || !Array.isArray(c.timeSlots)) continue;
      const next = [];
      for (const slot of c.timeSlots) {
        if (slot.day !== fromD || !hasWeek(slot.weeks, fromW)) {
          next.push(slot);
          continue;
        }
        moved++;
        const rest = removeWeek(slot.weeks, fromW);
        if (!rest) {
          // 起点仅此一周 → 该段整体搬迁到目标日
          slot.day = toD;
          slot.weeks = bitsOf(toW);
          syncDerived(slot);
          next.push(slot);
        } else {
          // 起点还有其他周 → 原段去掉该周，另立目标周的新段
          slot.weeks = rest;
          syncDerived(slot);
          next.push(slot);
          next.push({
            id: null,
            day: toD,
            start: slot.start,
            step: slot.step,
            weeks: bitsOf(toW),
            startWeek: toW,
            endWeek: toW,
            isOdd: 0,
            room: slot.room || '',
            teach: slot.teach || '',
            customTime: slot.customTime || null,
          });
        }
        affected.add(c);
      }
      if (next.length) {
        next.sort((a, b) => a.day - b.day || a.start - b.start);
        c.timeSlots = next;
      }
    }
    return { moved, courses: affected.size };
  }

  return {
    removeWeek,
    bitsOf,
    hasWeek,
    syncDerived,
    dateOfWeekDay,
    weekDayOfDate,
    moveSlotOneWeek,
    moveSlotAll,
    adjustWholeDay,
  };
});
