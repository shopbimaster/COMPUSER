// 单测：core/conflict.js（node --test）
const test = require('node:test');
const assert = require('node:assert');
const C = require('../conflict.js');

const slot = (o) => Object.assign({ day: 1, start: 1, step: 2, startWeek: 1, endWeek: 16, isOdd: 0 }, o);

test('slotInWeek: 周次范围与单双周', () => {
  assert.strictEqual(C.slotInWeek(slot({ startWeek: 1, endWeek: 16, isOdd: 0 }), 1), true);
  assert.strictEqual(C.slotInWeek(slot({ startWeek: 1, endWeek: 16, isOdd: 0 }), 17), false);
  assert.strictEqual(C.slotInWeek(slot({ isOdd: 1 }), 2), false);  // 单周课不在双周
  assert.strictEqual(C.slotInWeek(slot({ isOdd: 1 }), 3), true);
  assert.strictEqual(C.slotInWeek(slot({ isOdd: 2 }), 3), false);  // 双周课不在单周
  assert.strictEqual(C.slotInWeek(slot({ isOdd: 2 }), 2), true);
});

test('sectionsOverlap: 节次区间重叠', () => {
  assert.strictEqual(C.sectionsOverlap(slot({ start: 2, step: 3 }), slot({ start: 4, step: 2 })), true);   // 2-4 与 4-5
  assert.strictEqual(C.sectionsOverlap(slot({ start: 2, step: 3 }), slot({ start: 5, step: 1 })), false);  // 2-4 与 5
  assert.strictEqual(C.sectionsOverlap(slot({ start: 1, step: 2 }), slot({ start: 3, step: 2 })), false);  // 1-2 与 3-4 相邻不重叠
});

test('weeksIntersect: 考虑奇偶的有效周交集', () => {
  assert.strictEqual(C.weeksIntersect(slot({ startWeek: 1, endWeek: 16 }), slot({ startWeek: 9, endWeek: 20 })), true);
  assert.strictEqual(C.weeksIntersect(slot({ startWeek: 1, endWeek: 8 }), slot({ startWeek: 9, endWeek: 16 })), false);
  // a 全周 1-16，b 双周 8-9：第 8 周（偶）两者都上 → 冲突
  assert.strictEqual(C.weeksIntersect(slot({ isOdd: 0 }), slot({ startWeek: 8, endWeek: 9, isOdd: 2 })), true);
});

test('slotsConflict: 需同一天+节次重叠+周交集', () => {
  assert.strictEqual(C.slotsConflict(slot({ day: 1, start: 1, step: 2 }), slot({ day: 1, start: 2, step: 2 })), true);
  assert.strictEqual(C.slotsConflict(slot({ day: 1, start: 1, step: 2 }), slot({ day: 2, start: 2, step: 2 })), false);
});

test('findConflicts: 跨课程冲突对，同课程时间段不算', () => {
  const A = { id: 'a', name: 'A' };
  const B = { id: 'b', name: 'B' };
  const entries = [
    { course: A, slot: slot({ id: 'a1', day: 1, start: 1, step: 2 }) },
    { course: B, slot: slot({ id: 'b1', day: 1, start: 2, step: 2 }) },     // 与 a1 冲突
    { course: B, slot: slot({ id: 'b2', day: 1, start: 1, step: 2 }) },     // 与 a1 冲突、与 b1 同课程不算
    { course: A, slot: slot({ id: 'a2', day: 5, start: 1, step: 2 }) }      // 无冲突
  ];
  const pairs = C.findConflicts(entries);
  assert.strictEqual(pairs.length, 2);
  assert.strictEqual(C.conflictsOf(entries, 'a', 'a1').length, 2);
  assert.strictEqual(C.conflictsOf(entries, 'a', 'a2').length, 0);
});
