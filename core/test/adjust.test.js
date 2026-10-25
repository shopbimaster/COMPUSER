// 单测：core/adjust.js（调课数据变换，node --test）
const test = require('node:test');
const assert = require('node:assert');
const Adj = require('../adjust.js');

// 构造最小课程对象
function mkCourse(slots) {
  return { id: 'c1', name: '课', timeSlots: slots };
}
function mkSlot(day, start, step, weeks) {
  const s = { id: 's', day, start, step, weeks, startWeek: 1, endWeek: 1, isOdd: 0, room: 'R', teach: 'T', customTime: null };
  Adj.syncDerived(s);
  return s;
}

test('adjust: removeWeek / bitsOf / hasWeek 基础', () => {
  assert.strictEqual(Adj.removeWeek('1111', 2), '1011');
  assert.strictEqual(Adj.removeWeek('0100', 1), '0100'); // 第1周本就没有
  assert.strictEqual(Adj.removeWeek('0100', 2), ''); // 摘到空
  assert.strictEqual(Adj.bitsOf(1), '1');
  assert.strictEqual(Adj.bitsOf(5), '00001');
  assert.strictEqual(Adj.hasWeek('1011', 2), false);
  assert.strictEqual(Adj.hasWeek('1011', 3), true);
  assert.strictEqual(Adj.hasWeek('101', 9), false); // 越界
});

test('adjust: syncDerived 派生字段（起止周/单双周）', () => {
  const even = { weeks: '0101010101010101', startWeek: 1, endWeek: 16, isOdd: 0 };
  Adj.syncDerived(even);
  assert.strictEqual(even.startWeek, 2);
  assert.strictEqual(even.endWeek, 16);
  assert.strictEqual(even.isOdd, 2); // 全偶周
  const odd = { weeks: '101010101010101', startWeek: 1, endWeek: 15, isOdd: 0 };
  Adj.syncDerived(odd);
  assert.strictEqual(odd.startWeek, 1);
  assert.strictEqual(odd.isOdd, 1); // 全奇周
  const mix = { weeks: '1111', startWeek: 1, endWeek: 4, isOdd: 0 };
  Adj.syncDerived(mix);
  assert.strictEqual(mix.isOdd, 0); // 混合
});

test('adjust: dateOfWeekDay / weekDayOfDate 互逆与范围', () => {
  const ts = '2026-08-31'; // 周一
  assert.strictEqual(Adj.dateOfWeekDay(ts, 1, 1), '2026-08-31');
  assert.strictEqual(Adj.dateOfWeekDay(ts, 2, 3), '2026-09-09'); // 第2周周三
  assert.deepStrictEqual(Adj.weekDayOfDate(ts, '2026-09-09', 20), { w: 2, d: 3 });
  assert.strictEqual(Adj.weekDayOfDate(ts, '2026-08-30', 20), null); // 学期前
  assert.strictEqual(Adj.weekDayOfDate(ts, '2026-12-31', 1), null); // 超出总周数（12-31 为第 18 周）
});

test('adjust: weekDayOfDate 学期内正常换算', () => {
  const ts = '2026-08-31';
  const r = Adj.weekDayOfDate(ts, '2026-10-15', 20); // 08-31+45天 = 第 7 周周四
  assert.strictEqual(r.w, 7);
  assert.strictEqual(r.d, 4);
});

test('adjust: moveSlotOneWeek 多周段摘除一周并新增单周目标段', () => {
  const c = mkCourse([mkSlot(5, 1, 2, '1111111111111111')]); // 周五1-2节 1-16周
  const ok = Adj.moveSlotOneWeek(c, 0, 3, 1, 6, 2); // 第3周那次调到 周一6-7节
  assert.strictEqual(ok, true);
  assert.strictEqual(c.timeSlots.length, 2);
  const rest = c.timeSlots[1]; // 排序后周一(moved)在前、周五(rest)在后
  assert.strictEqual(rest.weeks, '1101111111111111'); // 第3周已摘除（index 2 置 0）
  assert.strictEqual(rest.startWeek, 1);
  assert.strictEqual(rest.endWeek, 16);
  assert.strictEqual(rest.day, 5); // 原星期不变
  const moved = c.timeSlots[0];
  assert.strictEqual(moved.day, 1);
  assert.strictEqual(moved.start, 6);
  assert.strictEqual(moved.step, 2);
  assert.strictEqual(moved.weeks, '001');
  assert.strictEqual(moved.startWeek, 3);
  assert.strictEqual(moved.endWeek, 3);
  assert.strictEqual(moved.room, 'R'); // 教室/教师继承
  // 排序：周一在前
  assert.strictEqual(c.timeSlots[0].day, 1);
});

test('adjust: moveSlotOneWeek 单周段整体搬迁', () => {
  const c = mkCourse([mkSlot(2, 3, 1, '00100')]); // 仅第3周
  Adj.moveSlotOneWeek(c, 0, 3, 4, 5, 1);
  assert.strictEqual(c.timeSlots.length, 1);
  assert.strictEqual(c.timeSlots[0].day, 4);
  assert.strictEqual(c.timeSlots[0].start, 5);
  assert.strictEqual(c.timeSlots[0].weeks, '001'); // 仍第3周（位串长度=末周）
});

test('adjust: moveSlotOneWeek 目标周不在段内 → 不修改', () => {
  const c = mkCourse([mkSlot(2, 3, 1, '00100')]);
  const before = JSON.stringify(c);
  assert.strictEqual(Adj.moveSlotOneWeek(c, 0, 5, 1, 1, 1), false);
  assert.strictEqual(JSON.stringify(c), before);
});

test('adjust: moveSlotAll 整段移动', () => {
  const c = mkCourse([mkSlot(5, 1, 2, '1111')]);
  Adj.moveSlotAll(c, 0, 2, 6, 1);
  assert.strictEqual(c.timeSlots[0].day, 2);
  assert.strictEqual(c.timeSlots[0].start, 6);
  assert.strictEqual(c.timeSlots[0].step, 1);
  assert.strictEqual(c.timeSlots[0].weeks, '1111'); // 周次不变
});

test('adjust: adjustWholeDay 整日搬迁（混合段拆分）', () => {
  const c1 = mkCourse([
    mkSlot(1, 1, 2, '111111'), // 周一1-2节 1-6周
  ]);
  const c2 = mkCourse([
    mkSlot(1, 3, 1, '001001'), // 周一第3节 第3、6周
  ]);
  const courses = [c1, c2];
  // 第2周周一 → 第5周周三
  const r = Adj.adjustWholeDay(courses, 2, 1, 5, 3);
  assert.strictEqual(r.moved, 1); // 仅 c1 的段含第2周
  assert.strictEqual(r.courses, 1);
  // c1：1-6周摘除第2周 → '101111'，新增 第5周周三1-2节
  assert.strictEqual(c1.timeSlots.length, 2);
  assert.strictEqual(c1.timeSlots[0].weeks, '101111');
  const mv = c1.timeSlots[1];
  assert.strictEqual(mv.day, 3);
  assert.strictEqual(mv.weeks, '00001');
  assert.strictEqual(mv.start, 1);
  // c2：第3、6周不含第2周 → 不动
  assert.strictEqual(c2.timeSlots.length, 1);
  assert.strictEqual(c2.timeSlots[0].weeks, '001001');
});

test('adjust: adjustWholeDay 起点仅此一周的段整体搬迁', () => {
  const c = mkCourse([mkSlot(1, 1, 1, '01000')]); // 仅第2周周一
  const r = Adj.adjustWholeDay([c], 2, 1, 4, 5);
  assert.strictEqual(r.moved, 1);
  assert.strictEqual(c.timeSlots.length, 1);
  assert.strictEqual(c.timeSlots[0].day, 5);
  assert.strictEqual(c.timeSlots[0].weeks, '0001'); // 第4周（位串长度=末周）
});

test('adjust: adjustWholeDay 目标周越界时位串扩展', () => {
  const c = mkCourse([mkSlot(1, 1, 1, '1100')]); // 1-2周
  Adj.adjustWholeDay([c], 1, 1, 6, 2); // 调到第6周（位串需扩到 6 位）
  const moved = c.timeSlots[1]; // [0]=原段(去掉第1周), [1]=新段(第6周周二)
  assert.strictEqual(moved.weeks, '000001');
  assert.strictEqual(moved.day, 2);
});

test('adjust: adjustWholeDay 无匹配日无修改', () => {
  const c = mkCourse([mkSlot(3, 1, 1, '1111')]); // 周三的课
  const before = JSON.stringify(c);
  const r = Adj.adjustWholeDay([c], 2, 1, 5, 3); // 调周一
  assert.strictEqual(r.moved, 0);
  assert.strictEqual(JSON.stringify(c), before);
});
