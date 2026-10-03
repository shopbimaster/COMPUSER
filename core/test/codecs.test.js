// 单测：core/codec/share.js + csv.js + ics.js（node --test）
const test = require('node:test');
const assert = require('node:assert');
const M = require('../model.js');
const Share = require('../codec/share.js');
const Csv = require('../codec/csv.js');
const Ics = require('../codec/ics.js');

const sampleSchedule = () => M.normalizeSchedule({
  id: 's1', name: '测试课表',
  settings: { termStart: '2026-09-28', classNum: 11 },
  courses: [
    {
      id: 'c1', name: '高等数学', color: 3, credit: 4, note: '带教材',
      timeSlots: [
        { id: 't1', day: 1, start: 1, step: 2, startWeek: 1, endWeek: 16, isOdd: 0, room: '逸夫楼301', teach: '张三' },
        { id: 't2', day: 3, start: 6, step: 2, startWeek: 9, endWeek: 16, isOdd: 0, room: '逸夫楼302', teach: '张三' }
      ]
    },
    {
      id: 'c2', name: '体育', color: -1,
      timeSlots: [{ id: 't3', day: 5, start: 3, step: 2, startWeek: 1, endWeek: 16, isOdd: 1, room: '田径场', teach: '' }]
    }
  ]
});

// ---------- share（QR/口令） ----------
test('share: 口令 roundtrip（压缩或降级均正确）', async () => {
  const sch = sampleSchedule();
  const enc = await Share.encodeShare(sch);
  assert.ok(!enc.error, enc.error);
  assert.ok(/^WU[01]:/.test(enc.code));
  const dec = await Share.decodeShare(enc.code);
  assert.ok(!dec.error, dec.error);
  assert.deepStrictEqual(dec.schedule, sch);
});

test('share: 非法口令报错', async () => {
  assert.ok((await Share.decodeShare('')).error);
  assert.ok((await Share.decodeShare('hello world')).error);
  assert.ok((await Share.decodeShare('WU1:!!!not-base64!!!')).error);
});

// ---------- csv ----------
test('csv: roundtrip（含逗号/引号转义、多时间段聚合、单双周）', () => {
  const sch = sampleSchedule();
  sch.courses[0].timeSlots[0].room = '逸夫楼3,01';  // 逗号需转义
  sch.courses[0].note = '带"教材"';                  // 引号需转义
  const csv = Csv.toCsv(sch);
  assert.ok(csv.startsWith('\uFEFF'));
  const r = Csv.parseCsv(csv);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.courses.length, 2);
  const math = r.courses.find(c => c.name === '高等数学');
  assert.strictEqual(math.timeSlots.length, 2);
  assert.strictEqual(math.timeSlots[0].room, '逸夫楼3,01');
  assert.strictEqual(math.note, '带"教材"');
  assert.strictEqual(math.credit, 4);
  const pe = r.courses.find(c => c.name === '体育');
  assert.strictEqual(pe.timeSlots[0].isOdd, 1);
});

test('csv: 容错（周天别名、数字星期、无效行跳过、缺列报错）', () => {
  const csv = [
    '星期,开始节,结束节,开始周,结束周,周类型,课程名,教师,教室',
    '周天,1,2,1,16,每周,选修课,,,,',
    '2,3,4,1,8,双周,数字天课,,,',
    '周八,1,2,1,16,每周,坏行,,,,',   // 星期非法 → 跳过
    ',1,2,1,16,每周,,,,'              // 无课程名 → 跳过
  ].join('\r\n');
  const r = Csv.parseCsv(csv);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.courses.length, 2);
  assert.strictEqual(r.courses[0].timeSlots[0].day, 7);   // 周天 → 7
  assert.strictEqual(r.courses[1].timeSlots[0].day, 2);   // 数字星期
  assert.strictEqual(r.courses[1].timeSlots[0].isOdd, 2);
  assert.ok(r.skipped >= 2);
  assert.ok(Csv.parseCsv('名字不对\n1,2').error);
  assert.ok(Csv.parseCsv('').error);
});

// ---------- ics ----------
test('ics: 结构、时区、RRULE 与转义', () => {
  const sch = sampleSchedule();
  sch.courses[0].timeSlots[0].room = '教1,101'; // 逗号转义
  const ics = Ics.toIcs(sch);

  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('TZID:Asia/Shanghai'));
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(ics.includes('\r\n'));

  // 高数周一 1-2 节：首次 2026-09-28（第1周周一）08:00
  assert.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20260928T080000'));
  assert.ok(ics.includes('DTEND;TZID=Asia/Shanghai:20260928T095000'));
  // 每周课 INTERVAL=1，末次为第16周周一 2027-01-11
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20270111T095000'));
  assert.ok(ics.includes('LOCATION:教1\\,101'));

  // 体育：周五 第3节(10:10) 单周 1~16 → INTERVAL=2，首次第1周周五 2026-10-02，末次第15周周五 2027-01-08
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20270108T'));
  assert.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20261002T101000'));

  // 第二时间段：周三 6-7 节 9~16 周 → 首次第9周周三 2026-11-25（第6节 14:30）
  assert.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20261125T143000'));
});

test('ics: 单周课从偶数起始周时首次上课为第3周', () => {
  const sch = M.normalizeSchedule({
    settings: { termStart: '2026-09-28' },
    courses: [{
      name: '偶起单周课',
      timeSlots: [{ day: 2, start: 1, step: 2, startWeek: 2, endWeek: 10, isOdd: 1 }]
    }]
  });
  const ics = Ics.toIcs(sch);
  // 第一个有效周为 3：周二 → 2026-10-13
  assert.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20261013T080000'));
});
