// 单测：core/week.js（node --test）
const test = require('node:test');
const assert = require('node:assert');
const W = require('../week.js');

test('mondayIndex: 周一=0 ... 周日=6', () => {
  assert.strictEqual(W.mondayIndex(new Date(2026, 9, 5)), 0);  // 2026-10-05 周一
  assert.strictEqual(W.mondayIndex(new Date(2026, 9, 4)), 6);  // 2026-10-04 周日
});

test('weekAnchor: 学期开始日期所在周的周一', () => {
  assert.strictEqual(W.fmtDate(W.weekAnchor('2026-09-28')), '2026-09-28'); // 本身是周一
  assert.strictEqual(W.fmtDate(W.weekAnchor('2026-10-01')), '2026-09-28'); // 周四 → 回退到周一
  assert.strictEqual(W.fmtDate(W.weekAnchor('2026-10-04')), '2026-09-28'); // 周日 → 回退到周一
});

test('calcCurrentWeek: 还原原版 天数差/7+1', () => {
  assert.strictEqual(W.calcCurrentWeek('2026-09-28', W.parseDate('2026-09-28')), 1);  // 开学第1天
  assert.strictEqual(W.calcCurrentWeek('2026-09-28', W.parseDate('2026-10-04')), 1);  // 第1周周日
  assert.strictEqual(W.calcCurrentWeek('2026-09-28', W.parseDate('2026-10-05')), 2);  // 第2周周一
  assert.strictEqual(W.calcCurrentWeek('2026-09-28', W.parseDate('2026-11-15')), 7);  // 第7周周日
  assert.strictEqual(W.calcCurrentWeek('2026-09-28', W.parseDate('2026-09-27')), 0);  // 开学前
});

test('dayDate: 第w周星期d 的日期', () => {
  assert.strictEqual(W.fmtDate(W.dayDate('2026-09-28', 1, 1)), '2026-09-28');
  assert.strictEqual(W.fmtDate(W.dayDate('2026-09-28', 1, 7)), '2026-10-04');
  assert.strictEqual(W.fmtDate(W.dayDate('2026-09-28', 3, 3)), '2026-10-14');
});

test('weeksFromDates: 日期模式换算周次', () => {
  assert.deepStrictEqual(W.weeksFromDates('2026-09-28', '2026-10-05', '2026-11-15'), { startWeek: 2, endWeek: 7 });
  assert.deepStrictEqual(W.weeksFromDates('2026-09-28', '2026-11-15', '2026-10-05'), { startWeek: 2, endWeek: 7 }); // 反填自动交换
  assert.deepStrictEqual(W.weeksFromDates('2026-09-28', '2026-09-20', '2026-09-25'), { startWeek: 1, endWeek: 1 }); // 学期前收敛为1
});

test('时间工具', () => {
  assert.strictEqual(W.toMinutes('08:30'), 510);
  assert.strictEqual(W.minutesToTime(510), '08:30');
  assert.strictEqual(W.addMinutes('23:50', 30), '00:20');
  assert.strictEqual(W.addMinutes('08:00', 45), '08:45');
});

test('fmtYmd: iCal 日期格式', () => {
  assert.strictEqual(W.fmtYmd(W.parseDate('2026-10-05')), '20261005');
});
