// 单测：core/merge.js（node --test）
const test = require('node:test');
const assert = require('node:assert');
const M = require('../model.js');
const Merge = require('../merge.js');

const sch = (id, over) => Object.assign({
  id, name: '课表' + id, updatedAt: 100,
  settings: { termStart: '2026-09-28', classNum: 11 },
  courses: [], tombstones: {}
}, over || {});

const course = (id, updatedAt, over) => Object.assign({
  id, updatedAt, name: '课程' + id, color: -1, credit: null, note: '',
  timeSlots: [{ id: 'ts' + id, day: 1, start: 1, step: 2, startWeek: 1, endWeek: 16, isOdd: 0, room: '', teach: '', customTime: null }]
}, over || {});

const state = (over) => M.normalizeState(Object.assign({
  device: 'd-local', prefs: { theme: 'light' }, currentScheduleId: 's1',
  schedules: [sch('s1')]
}, over || {}));

test('并集：对方独有的课表被合入', () => {
  const l = state(), r = state({ device: 'd-remote', currentScheduleId: 's2', schedules: [sch('s2')] });
  const out = Merge.mergeState(l, r);
  assert.strictEqual(out.schedules.length, 2);
  assert.ok(out.schedules.find(s => s.id === 's1'));
  assert.ok(out.schedules.find(s => s.id === 's2'));
  assert.strictEqual(out.currentScheduleId, 's1'); // 以本地为准
  assert.strictEqual(out.device, 'd-local');
});

test('课程级 LWW：新者胜', () => {
  const l = state({ schedules: [sch('s1', { courses: [course('c1', 100, { name: '旧名' })] })] });
  const r = state({ schedules: [sch('s1', { courses: [course('c1', 200, { name: '新名' })] })] });
  const out = Merge.mergeState(l, r);
  assert.strictEqual(out.schedules[0].courses[0].name, '新名');
  // 反方向合并，同样的赢家
  const out2 = Merge.mergeState(r, l);
  assert.strictEqual(out2.schedules[0].courses[0].name, '新名');
});

test('课程级 LWW：平局本地胜（确定性）', () => {
  const l = state({ schedules: [sch('s1', { courses: [course('c1', 100, { name: '本地' })] })] });
  const r = state({ schedules: [sch('s1', { courses: [course('c1', 100, { name: '对方' })] })] });
  assert.strictEqual(Merge.mergeState(l, r).schedules[0].courses[0].name, '本地');
  assert.strictEqual(Merge.mergeState(r, l).schedules[0].courses[0].name, '对方'); // 各自视角本地胜
});

test('并发编辑不同课程：两门都保留', () => {
  const l = state({ schedules: [sch('s1', { courses: [course('cA', 300)] })] });
  const r = state({ schedules: [sch('s1', { courses: [course('cB', 500)] })] });
  const out = Merge.mergeState(l, r);
  assert.strictEqual(out.schedules[0].courses.length, 2);
});

test('墓碑：删除晚于对方编辑 → 删除胜', () => {
  const l = state({ schedules: [sch('s1', { courses: [], tombstones: { c1: 500 } })] });
  const r = state({ schedules: [sch('s1', { courses: [course('c1', 200)] })] });
  const out = Merge.mergeState(l, r);
  assert.strictEqual(out.schedules[0].courses.length, 0);
});

test('墓碑：对方编辑晚于删除 → 课程复活', () => {
  const l = state({ schedules: [sch('s1', { courses: [], tombstones: { c1: 200 } })] });
  const r = state({ schedules: [sch('s1', { courses: [course('c1', 500)] })] });
  const out = Merge.mergeState(l, r);
  assert.strictEqual(out.schedules[0].courses.length, 1);
});

test('表级字段 LWW：设置按 schedule.updatedAt 取新', () => {
  const l = state({ schedules: [sch('s1', { updatedAt: 100, settings: { termStart: '2026-09-28' } })] });
  const r = state({ schedules: [sch('s1', { updatedAt: 900, name: '新名字', settings: { termStart: '2026-09-07' } })] });
  const out = Merge.mergeState(l, r);
  assert.strictEqual(out.schedules[0].name, '新名字');
  assert.strictEqual(out.schedules[0].settings.termStart, '2026-09-07');
  assert.strictEqual(out.schedules[0].updatedAt, 900);
});

test('收敛性：双向合并结果一致（无并发同课程编辑时）', () => {
  const l = state({ schedules: [sch('s1', { courses: [course('c1', 100)] })] });
  const r = state({ device: 'd-remote', schedules: [sch('s1', { courses: [course('c2', 200)] })] });
  const a = Merge.mergeState(l, r);
  const b = Merge.mergeState(r, l);
  assert.deepStrictEqual(
    a.schedules[0].courses.map(c => c.id).sort(),
    b.schedules[0].courses.map(c => c.id).sort()
  );
});
