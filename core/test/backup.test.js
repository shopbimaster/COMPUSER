// 单测：core/codec/backup.js（node --test）
const test = require('node:test');
const assert = require('node:assert');
const M = require('../model.js');
const B = require('../codec/backup.js');

const sampleState = () => M.normalizeState({
  device: 'd-test',
  schedules: [{
    id: 's1', name: '我的课表', settings: { termStart: '2026-09-28' },
    courses: [{ id: 'c1', name: '高数', timeSlots: [{ day: 1, start: 1, step: 2, room: '301' }] }]
  }]
});

test('完整备份 roundtrip：serialize → parseAuto 还原', () => {
  const st = sampleState();
  const r = B.parseAuto(B.serialize(st));
  assert.strictEqual(r.kind, 'backup');
  assert.deepStrictEqual(r.state, st);
});

test('单表分享：serializeShare → parseAuto 识别为 share', () => {
  const st = sampleState();
  const r = B.parseAuto(B.serializeShare(st.schedules[0]));
  assert.strictEqual(r.kind, 'share');
  assert.strictEqual(r.schedule.id, 's1');
  assert.strictEqual(r.schedule.courses[0].name, '高数');
});

test('v1 旧备份自动迁移', () => {
  const v1Text = JSON.stringify({
    app: 'wakeup-schedule-local', version: 1,
    courses: [{ id: 'c1', name: '旧课', day: 3, start: 1, step: 2, startWeek: 1, endWeek: 16, isOdd: 0 }],
    settings: { termStart: '2026-09-28' }
  });
  const r = B.parseAuto(v1Text);
  assert.strictEqual(r.kind, 'backup');
  assert.strictEqual(r.state.schedules[0].courses[0].name, '旧课');
  assert.strictEqual(r.state.schedules[0].courses[0].timeSlots[0].day, 3);
});

test('垃圾输入报错', () => {
  assert.ok(B.parseAuto('not json').error);
  assert.ok(B.parseAuto('123').error);
  assert.ok(B.parseAuto('{"foo":1}').error);
});

test('parseBackup / parseShare 严格模式', () => {
  const st = sampleState();
  assert.ok(B.parseBackup(B.serializeShare(st.schedules[0])).error); // 分享文件 ≠ 备份
  assert.ok(B.parseShare(B.serialize(st)).error);                   // 备份 ≠ 分享文件
});
