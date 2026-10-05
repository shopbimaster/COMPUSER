/*!
 * WakeUp 课程表本地版 · 领域内核：课程冲突检测（纯函数，零平台依赖）
 * "时间段"(slot) 需含 {day, start, step, weeks}（'0'/'1' 位串，唯一真源），
 * 兼容旧字段 {startWeek, endWeek, isOdd}（0=每周 1=单周 2=双周，v1 平铺课程对象天然 slot 兼容）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WakeupConflict = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 该周是否上这节课（还原原版 ScheduleFragment 判断）
  function slotInWeek(slot, w) {
    if (typeof slot.weeks === 'string' && slot.weeks) return slot.weeks.charAt(w - 1) === '1';
    // 旧字段回退（未升级数据）
    if (slot.startWeek > w || slot.endWeek < w) return false;
    if (slot.isOdd === 1 && w % 2 === 0) return false; // 单周课不在双周
    if (slot.isOdd === 2 && w % 2 === 1) return false; // 双周课不在单周
    return true;
  }

  // 节次区间是否重叠
  function sectionsOverlap(a, b) {
    return !(a.start > b.start + b.step - 1 || b.start > a.start + a.step - 1);
  }

  // 有效周是否存在交集（weeks 位串可有任意空洞，从头扫到两者区间上界）
  function weeksIntersect(a, b) {
    const hi = Math.max(Number(a.endWeek) || 1, Number(b.endWeek) || 1);
    for (let w = 1; w <= hi; w++) {
      if (slotInWeek(a, w) && slotInWeek(b, w)) return true;
    }
    return false;
  }

  function slotsConflict(a, b) {
    return a.day === b.day && sectionsOverlap(a, b) && weeksIntersect(a, b);
  }

  // entries: [{course, slot}]，返回冲突对 [{a, b}]（a/b 为 entry）
  // 同一门课的多个时间段之间不算冲突（对应原版"冲突课程=不同课程"语义）
  function findConflicts(entries) {
    const pairs = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i].course.id === entries[j].course.id) continue;
        if (slotsConflict(entries[i].slot, entries[j].slot)) {
          pairs.push({ a: entries[i], b: entries[j] });
        }
      }
    }
    return pairs;
  }

  // 指定 (courseId, slotId) 的所有冲突
  function conflictsOf(entries, courseId, slotId) {
    return findConflicts(entries).filter(p =>
      (p.a.course.id === courseId && p.a.slot.id === slotId) ||
      (p.b.course.id === courseId && p.b.slot.id === slotId));
  }

  return { slotInWeek, sectionsOverlap, weeksIntersect, slotsConflict, findConflicts, conflictsOf };
});
