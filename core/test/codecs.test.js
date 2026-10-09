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

// ---------- ics 导入 ----------
// 原版 WakeUpSchedule 导出风格：DESCRIPTION 首行为节次、RRULE 无 BYDAY、UNTIL 为 UTC
test('ics 导入: WakeUp 风格事件（节次取自 DESCRIPTION、UNTIL 时刻比较、VALARM 忽略）', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YZune//WakeUpSchedule//EN',
    'BEGIN:VEVENT',
    'DTSTAMP:20261009T150043Z',
    'UID:WakeUpSchedule-464cca17',
    'SUMMARY:硬件综合训练',
    'DTSTART;TZID=/Asia/Shanghai:20260831T140000',
    'DTEND;TZID=/Asia/Shanghai:20260831T173000',
    'RRULE:FREQ=WEEKLY;UNTIL=20260913T160000Z;INTERVAL=1',
    'LOCATION:计算机大楼2013A ',
    'DESCRIPTION:第5 - 8节\\n计算机大楼2013A',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER;RELATED=START:-PT20M',
    'DESCRIPTION:硬件综合训练@计算机大楼2013A\\n',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const r = Ics.parseIcs(ics, '大三上.ics');
  assert.ok(!r.error, r.error);
  const sch = r.schedule;
  // 锚点 = 最早事件所在周周一；UNTIL=20260913T160000Z → 本地 2026-09-14 00:00，第 3 周周一 14:00 超出 → 仅 1~2 周
  assert.strictEqual(sch.settings.termStart, '2026-08-31');
  assert.strictEqual(sch.name, '大三上'); // 无 X-WR-CALNAME → 文件名去扩展名
  assert.strictEqual(sch.courses.length, 1);
  const sl = sch.courses[0].timeSlots[0];
  assert.strictEqual(sl.day, 1);
  assert.strictEqual(sl.start, 5);
  assert.strictEqual(sl.step, 4);
  assert.strictEqual(sl.weeks, '11'); // 第 1~2 周（位串长度 = 末个选中周）
  assert.strictEqual(sl.room, '计算机大楼2013A');
  assert.deepStrictEqual(sl.customTime, { start: '14:00', end: '17:30' });
  // 观测到的节时刻写入时间表：第 5 节 14:00、第 8 节 17:30
  assert.strictEqual(sch.settings.times[4].start, '14:00');
  assert.strictEqual(sch.settings.times[7].end, '17:30');
});

test('ics 导入: INTERVAL=2 单双周由实际日期涌现、无 RRULE 按单次、同名课程聚合', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:锚点课',               // 每周，仅第 1 周：UNTIL 落在第 1 周内
    'DTSTART:20260831T080000',
    'DTEND:20260831T094000',
    'RRULE:FREQ=WEEKLY;UNTIL=20260904T235900;INTERVAL=1',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:双周课',               // 首次在第 2 周周二，隔周 → 2/4/6 周
    'DTSTART:20260908T101000',
    'DTEND:20260908T115000',
    'RRULE:FREQ=WEEKLY;UNTIL=20261006T235900;INTERVAL=2',
    'END:VEVENT',
    'BEGIN:VEVENT',                 // 同名课另一时间段（无 RRULE → 单次）
    'SUMMARY:双周课',
    'DTSTART:20261007T140000',
    'DTEND:20261007T153500',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const r = Ics.parseIcs(ics);
  assert.ok(!r.error, r.error);
  const sch = r.schedule;
  assert.strictEqual(sch.settings.termStart, '2026-08-31');
  assert.strictEqual(sch.courses.length, 2);
  const bi = sch.courses.find((c) => c.name === '双周课');
  assert.strictEqual(bi.timeSlots.length, 2);
  assert.strictEqual(bi.timeSlots[0].weeks, '010101');
  assert.strictEqual(bi.timeSlots[0].isOdd, 2); // 位串 2/4/6 → 派生双周
  assert.strictEqual(bi.timeSlots[0].start, 3); // 无节次提示 → 默认时间表就近匹配 10:10 → 第 3 节
  assert.strictEqual(bi.timeSlots[1].day, 3);   // 2026-10-07 周三
  assert.strictEqual(bi.timeSlots[1].weeks, '000001'); // 相对全局锚点为第 6 周
  assert.strictEqual(bi.timeSlots[1].step, 3);  // 14:00-15:35 → 默认表最小覆盖为第 5-7 节（真实时刻存 customTime）
});

test('ics 导入: 本应用导出 roundtrip（节次/教师/学分/备注/单双周还原）', () => {
  const src = sampleSchedule();
  const r = Ics.parseIcs(Ics.toIcs(src));
  assert.ok(!r.error, r.error);
  const sch = r.schedule;
  assert.strictEqual(sch.name, '测试课表');            // X-WR-CALNAME
  assert.strictEqual(sch.settings.termStart, '2026-09-28');
  assert.strictEqual(sch.courses.length, 2);
  const math = sch.courses.find((c) => c.name === '高等数学');
  assert.strictEqual(math.credit, 4);
  assert.strictEqual(math.note, '带教材');
  assert.strictEqual(math.timeSlots.length, 2);
  assert.strictEqual(math.timeSlots[0].day, 1);
  assert.strictEqual(math.timeSlots[0].start, 1);
  assert.strictEqual(math.timeSlots[0].step, 2);
  assert.strictEqual(math.timeSlots[0].weeks, '1111111111111111');
  assert.strictEqual(math.timeSlots[0].room, '逸夫楼301');
  assert.strictEqual(math.timeSlots[0].teach, '张三');
  assert.strictEqual(math.timeSlots[1].weeks, '0000000011111111'); // 9~16 周
  const pe = sch.courses.find((c) => c.name === '体育');
  assert.strictEqual(pe.timeSlots[0].isOdd, 1);        // 单周由 INTERVAL=2 涌现
  assert.strictEqual(pe.timeSlots[0].weeks, '101010101010101'); // 单周 1~16 实为 1~15（16 为偶周）
});

test('ics 导入: 自动分配不重复颜色（池 12 色顺序循环）', () => {
  const names = Array.from({ length: 14 }, (_, i) => `课程${i + 1}`);
  const ics = [
    'BEGIN:VCALENDAR',
    ...names.flatMap((n, i) => [
      'BEGIN:VEVENT',
      `SUMMARY:${n}`,
      `DTSTART:2026090${(i % 5) + 1}T080000`,
      'DTEND:2026090' + ((i % 5) + 1) + 'T094000',
      'END:VEVENT'
    ]),
    'END:VCALENDAR'
  ].join('\r\n');
  const r = Ics.parseIcs(ics);
  assert.ok(!r.error, r.error);
  const colors = r.schedule.courses.map((c) => c.color);
  const pool = M.RANDOM_COLORS;
  assert.ok(colors.every((c) => pool.includes(c)));
  const first12 = new Set(colors.slice(0, 12));
  assert.strictEqual(first12.size, 12);      // 前 12 门互不重复
  assert.strictEqual(colors[12], colors[0]); // 超出池长从头部循环
  assert.strictEqual(colors[13], colors[1]);
});

test('csv 导入: 未填颜色列自动去重分配、显式颜色保留', () => {
  const csv = [
    '星期,开始节,结束节,开始周,结束周,周类型,课程名,教师,教室,颜色,学分,备注',
    '周一,1,2,1,16,每周,课甲,,,',
    '周二,1,2,1,16,每周,课乙,,,',
    '周三,1,2,1,16,每周,课丙,,,5',
    '周四,1,2,1,16,每周,课丁,,,'
  ].join('\r\n');
  const r = Csv.parseCsv(csv);
  assert.ok(!r.error, r.error);
  const by = Object.fromEntries(r.courses.map((c) => [c.name, c]));
  assert.notStrictEqual(by['课甲'].color, -1);
  assert.notStrictEqual(by['课乙'].color, -1);
  assert.notStrictEqual(by['课甲'].color, by['课乙'].color); // 自动分配不重复
  assert.strictEqual(by['课丙'].color, 5);                    // 显式颜色保留
  assert.notStrictEqual(by['课丁'].color, -1);
});

test('ics 导入: 匹配统计 stats 与 courseFormat 选项', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',                    // A：先出现，其时刻成为时间表观测值 → 与表精确匹配
    'SUMMARY:大课',
    'DTSTART:20260907T140000',
    'DTEND:20260907T173000',
    'END:VEVENT',
    'BEGIN:VEVENT',                    // B：与 A 重叠但时刻错位 → 结束时刻 ≠ 表值 → 不匹配
    'SUMMARY:杂事',
    'DTSTART:20260908T141000',
    'DTEND:20260908T170000',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const slots = (r) => r.schedule.courses.flatMap((c) => c.timeSlots);
  const plain = Ics.parseIcs(ics);
  assert.strictEqual(plain.stats.total, 2);
  assert.strictEqual(plain.stats.matched, 1);
  assert.ok(slots(plain)[0].customTime && slots(plain)[1].customTime);

  const fmt = Ics.parseIcs(ics, '', { courseFormat: true });
  const s2 = slots(fmt);
  assert.strictEqual(s2[0].customTime, null); // 匹配 → 去自定义时间，随时间表统一变更
  assert.ok(s2[1].customTime);                // 不匹配 → 保留固定时刻
});

test('ics 导入: 折行展开与转义还原、无 VEVENT 报错', () => {
  const longName = '超长课程名称测试'.repeat(12); // 必然触发 RFC 折行
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:' + longName.replace(/,/g, '\\,'),
    'DTSTART:20261007T140000',
    'LOCATION:教1\\,101',
    'DESCRIPTION:含\\\\反斜杠与\\;分号',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const r = Ics.parseIcs(ics);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.schedule.courses[0].name, longName);
  assert.strictEqual(r.schedule.courses[0].timeSlots[0].room, '教1,101');
  assert.ok(Ics.parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR').error);
  assert.ok(Ics.parseIcs('').error);
});
