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
  assert.strictEqual(st.format, 'wakeup-local/2');
  assert.strictEqual(st.schedules.length, 1);
  assert.ok(st.device && st.currentScheduleId);
  const c = st.schedules[0].courses[0];
  assert.strictEqual(c.id, 'c1');
  assert.strictEqual(c.name, '高等数学');
  assert.strictEqual(c.color, 3);
  assert.strictEqual(c.credit, null);
  assert.strictEqual(c.timeSlots.length, 1);
  const s = c.timeSlots[0];
  assert.deepStrictEqual(
    { day: s.day, start: s.start, step: s.step, startWeek: s.startWeek, endWeek: s.endWeek, isOdd: s.isOdd, room: s.room, teach: s.teach },
    { day: 1, start: 2, step: 3, startWeek: 1, endWeek: 16, isOdd: 1, room: '逸夫楼301', teach: '张三' }
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

test('normalizeState: 深度规范化后 roundtrip 稳定', () => {
  const st1 = M.normalizeState({ schedules: [{ id: 's', courses: [{ id: 'c', name: 'A', timeSlots: [{ day: 2 }] }] }] });
  const st2 = M.normalizeState(JSON.parse(JSON.stringify(st1)));
  assert.deepStrictEqual(st1, st2);
});
