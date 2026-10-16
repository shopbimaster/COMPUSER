// 单测：core/model.js（node --test）
const test = require('node:test');
const assert = require('node:assert');
const M = require('../model.js');

test('migrate: v1 平铺课程 → v2 基础信息+单时间段', () => {
  const v1 = {
    courses: [{
      id: 'c1', name: '高等数学', room: '逸夫楼301', teach: '张三',
      day: 1, start: 2, step: 3, startWeek: 1, endWeek: 16, isOdd: 1, color: 3
    }],
    settings: { termStart: '2026-09-28', classNum: 11 }
  };
  const st = M.migrate(v1);
  assert.strictEqual(st.format, 'campuser-schedule/2');
  assert.strictEqual(st.schedules.length, 1);
  assert.ok(st.device && st.currentScheduleId);
  const c = st.schedules[0].courses[0];
  assert.strictEqual(c.id, 'c1');
  assert.strictEqual(c.name, '高等数学');
  assert.strictEqual(c.color, 3);
  assert.strictEqual(c.credit, null);
  assert.strictEqual(c.timeSlots.length, 1);
  const s = c.timeSlots[0];
  assert.strictEqual(s.weeks, '1010101010101010'); // 单周 1..15 位串（唯一真源）
  assert.deepStrictEqual(
    { day: s.day, start: s.start, step: s.step, startWeek: s.startWeek, endWeek: s.endWeek, isOdd: s.isOdd, room: s.room, teach: s.teach },
    { day: 1, start: 2, step: 3, startWeek: 1, endWeek: 15, isOdd: 1, room: '逸夫楼301', teach: '张三' } // endWeek 由位串派生（16 为偶周不含）
  );
  assert.strictEqual(st.schedules[0].settings.termStart, '2026-09-28');
});

test('migrate: v1 color 缺失/空串 → 自动色 -1', () => {
  const st = M.migrate({ courses: [{ name: 'A' }, { name: 'B', color: '' }] });
  assert.strictEqual(st.schedules[0].courses[0].color, -1);
  assert.strictEqual(st.schedules[0].courses[1].color, -1);
});

test('migrate: v2 直通 + 悬空 currentScheduleId 修复', () => {
  const st = M.migrate({ schedules: [{ id: 's1' }, { id: 's2' }], currentScheduleId: 'sX' });
  assert.strictEqual(st.schedules.length, 2);
  assert.strictEqual(st.currentScheduleId, 's1');
});

test('migrate: 垃圾/空 → 全新状态（1 个默认课表）', () => {
  for (const bad of [null, undefined, 42, 'x', {}, []]) {
    const st = M.migrate(bad);
    assert.strictEqual(st.schedules.length, 1);
    assert.strictEqual(st.schedules[0].courses.length, 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(st.schedules[0].settings.termStart));
  }
});

test('normalizeSettings: 边界收敛与时间表补齐', () => {
  const s = M.normalizeSettings({ classNum: 99, alpha: 5, totalWeeks: 0, times: [{ start: '08:00', end: '08:45' }] });
  assert.strictEqual(s.classNum, 16);
  assert.strictEqual(s.alpha, 10);
  assert.strictEqual(s.totalWeeks, 20); // 0 视为未设置 → 默认 20
  assert.strictEqual(s.times.length, 16);
  assert.strictEqual(s.times[0].end, '08:45');
  assert.strictEqual(s.times[15].start, '01:30');
  const s2 = M.normalizeSettings({ classNum: 1 });
  assert.strictEqual(s2.classNum, 8); // 下限 8
});

test('normalizeSettings: courseGap 0 为合法值，超界收敛 0-10', () => {
  assert.strictEqual(M.normalizeSettings({ courseGap: 0 }).courseGap, 0);
  assert.strictEqual(M.normalizeSettings({ courseGap: 99 }).courseGap, 10);
  assert.strictEqual(M.normalizeSettings({ courseGap: -3 }).courseGap, 0);
  assert.strictEqual(
    M.normalizeSettings({ courseGap: 'abc' }).courseGap,
    M.DEFAULT_SETTINGS.courseGap,
  );
});

test('normalizeSettings: saturation 0 为合法值（全灰），超界收敛 0-100，缺省取默认表', () => {
  assert.strictEqual(M.normalizeSettings({ saturation: 0 }).saturation, 0);
  assert.strictEqual(M.normalizeSettings({ saturation: 150 }).saturation, 100);
  assert.strictEqual(M.normalizeSettings({ saturation: -5 }).saturation, 0);
  assert.strictEqual(
    M.normalizeSettings({ saturation: 'abc' }).saturation,
    M.DEFAULT_SETTINGS.saturation,
  );
  assert.strictEqual(
    M.normalizeSettings({}).saturation,
    M.DEFAULT_SETTINGS.saturation,
  );
  assert.strictEqual(
    M.normalizeSettings({}).courseGap,
    M.DEFAULT_SETTINGS.courseGap,
  );
});

test('normalizeSlot: 周次倒置收敛、customTime 校验、day 越界', () => {
  const s = M.normalizeSlot({ day: 9, start: 0, startWeek: 3, endWeek: 1, customTime: { start: '25:00', end: '09:00' } });
  assert.strictEqual(s.day, 7);
  assert.strictEqual(s.start, 1);
  assert.strictEqual(s.endWeek, 3);
  assert.strictEqual(s.customTime, null);
  const ok = M.normalizeSlot({ customTime: { start: '08:00', end: '09:40' } });
  assert.deepStrictEqual(ok.customTime, { start: '08:00', end: '09:40' });
});

test('normalizeCourse: 无时间段补默认；字符串色号兼容', () => {
  const c = M.normalizeCourse({ name: 'X' });
  assert.strictEqual(c.timeSlots.length, 1);
  assert.strictEqual(c.timeSlots[0].day, 1);
  const c2 = M.normalizeCourse({ name: 'Y', color: '5' });
  assert.strictEqual(c2.color, 5);
});

test('normalizeSlot: weeks 位串为唯一真源并派生区间/单双周', () => {
  // 区间+奇偶 → 展开位串
  const r = M.normalizeSlot({ startWeek: 1, endWeek: 4 });
  assert.strictEqual(r.weeks, '1111');
  assert.strictEqual(M.expandWeeks(1, 5, 1), '10101');
  // 不连续位串原样保留，派生区间 min..max、混合奇偶 isOdd=0
  const h = M.normalizeSlot({ weeks: '1101100' });
  assert.strictEqual(h.weeks, '1101100');
  assert.deepStrictEqual(
    { startWeek: h.startWeek, endWeek: h.endWeek, isOdd: h.isOdd },
    { startWeek: 1, endWeek: 5, isOdd: 0 }
  );
  // 区间内纯奇/纯偶 → 派生单/双周
  assert.strictEqual(M.normalizeSlot({ weeks: '01010' }).isOdd, 2);
  assert.strictEqual(M.normalizeSlot({ weeks: '0010100' }).isOdd, 1);
  // 非法位串（非 01/全 0）→ 回退区间展开
  const bad = M.normalizeSlot({ weeks: '0000', startWeek: 2, endWeek: 3 });
  assert.strictEqual(bad.weeks, '011');
  const junk = M.normalizeSlot({ weeks: 'abc1', startWeek: 2, endWeek: 2 });
  assert.strictEqual(junk.weeks, '01');
});

test('weeksLabel: 分段压缩人读标签', () => {
  assert.strictEqual(M.weeksLabel('1101100'), '第1-2、4-5周');
  assert.strictEqual(M.weeksLabel('00100'), '第3周');
  assert.strictEqual(M.weeksLabel('111'), '第1-3周');
  assert.strictEqual(M.weeksLabel('0000'), '');
  assert.strictEqual(M.weeksLabel(undefined), '');
});

test('normalizeState: 深度规范化后 roundtrip 稳定', () => {
  const st1 = M.normalizeState({ schedules: [{ id: 's', courses: [{ id: 'c', name: 'A', timeSlots: [{ day: 2 }] }] }] });
  const st2 = M.normalizeState(JSON.parse(JSON.stringify(st1)));
  assert.deepStrictEqual(st1, st2);
});
