// 单测：core/codec/hub.js（HUST 教务导入解析，node --test）
// fixtures 移植自 hust2ics 项目的真实响应样例（Hustoday v1.5.0 反编译产物测试数据），
// 覆盖：学期列表/当前学期选择/课表字段映射/多时间段聚合/脏数据告警/非法响应。
const test = require('node:test');
const assert = require('node:assert');
const Hub = require('../codec/hub.js');

// ---- fixtures（HUB 原始接口格式，与 mhub.hust.edu.cn 实测响应同构） ----

const XQ_LIST_RAW = JSON.stringify([
  { XQMC: '请选择', XQH: '', QSRQ: '', JSRQ: '' },
  { XQH: '20252', XQMC: '2025-2026学年第一学期', QSRQ: '2025-09-01', JSRQ: '2026-01-18' },
  { XQH: '20232', XQMC: '2023-2024学年第二学期', QSRQ: '2024-02-26', JSRQ: '2024-06-30' },
  { XQH: '20222', XQMC: '2022-2023学年第二学期', QSRQ: '2023-02-20', JSRQ: '2023-06-30' },
]);

const COURSE_RAW = JSON.stringify({
  termInfo: { XQH: '20232', XQMC: '2023-2024学年第二学期', QSRQ: '2024-02-26', JSRQ: '2024-06-30' },
  courseList: {
    data: [
      {
        KTBH: '20232w12501387', KTMC: '计算机类（一）2311-2312',
        KCMC: '中国近现代史纲要', XQH: '20232',
        tr: [{ XM: '魏维', XQ: '星期五', XQS: '5', QSZC: '1', JSZC: '16', QSJC: '1', JSJC: '2', JSMC: '西十二楼N111' }],
      },
      {
        KTBH: '20232w10745633', KTMC: '计算机类（一）2307-2312', KCMC: '物理实验（一）', XQH: '20232',
        tr: [
          { XM: null, XQ: '星期二', XQS: '2', QSZC: '1', JSZC: '1', QSJC: '9', JSJC: '12', JSMC: null },
          { XM: null, XQ: '星期四', XQS: '4', QSZC: '2', JSZC: '8', QSJC: '9', JSJC: '12', JSMC: '科技楼北楼物理实验教学中心' },
        ],
      },
      {
        KTBH: '20232w107453254', KTMC: '计算机类（一）2311-2312', KCMC: '综合英语（二）', XQH: '20232',
        tr: [
          { XM: '刘琼', XQ: '星期二', XQS: '2', QSZC: '1', JSZC: '14', QSJC: '5', JSJC: '6', JSMC: '西十二楼N208' },
          { XM: '刘琼', XQ: '星期五', XQS: '5', QSZC: '1', JSZC: '14', QSJC: '3', JSJC: '4', JSMC: '西十二楼N208' },
        ],
      },
      {
        KTBH: '20232w902757005', KTMC: '中国语文（课堂九）-古代文学课堂3',
        KCMC: '中国语文-古代文学经典与中华文化精神', XQH: '20232',
        tr: [{ XM: '谢超凡', XQ: '星期三', XQS: '3', QSZC: '1', JSZC: '11', QSJC: '9', JSJC: '10', JSMC: '东九楼C202' }],
      },
      {
        KTBH: '20232w900111001', KTMC: '羽毛球（二）1班', KCMC: '羽毛球（二）', XQH: '20232',
        tr: [{ XM: null, XQ: '星期一', XQS: '1', QSZC: '7', JSZC: '15', QSJC: '3', JSJC: '4', JSMC: '西十二楼N112' }],
      },
      // 脏数据：endSection 缺失 → 应被忽略并告警（与官方 App 行为一致）
      {
        KTBH: '20232w000000001', KTMC: '脏数据课堂', KCMC: '节次缺失课程', XQH: '20232',
        tr: [{ XM: null, XQ: '星期一', XQS: '1', QSZC: '1', JSZC: '16', QSJC: '1', JSJC: null, JSMC: null }],
      },
    ],
  },
});

// ---- 学期列表 ----

test('hub: 学期列表解析剔除占位项并映射字段', () => {
  const terms = Hub.parseXqList(XQ_LIST_RAW);
  assert.strictEqual(terms.length, 3); // 「请选择」占位项被剔除
  assert.deepStrictEqual(terms[0], { term: '20252', name: '2025-2026学年第一学期', startDate: '2025-09-01', endDate: '2026-01-18' });
});

test('hub: 学期列表响应为 {data:[...]} 包装时同样解析', () => {
  const wrapped = JSON.stringify({ data: JSON.parse(XQ_LIST_RAW) });
  assert.strictEqual(Hub.parseXqList(wrapped).length, 3);
});

test('hub: 学期列表为登录页 HTML 时抛带片段的错误', () => {
  assert.throws(() => Hub.parseXqList('<html><body>登录</body></html>'), /不是合法 JSON/);
});

test('hub: pickCurrentTerm 跳过第0项，第一个 JSRQ≤today 的前一项为当前学期', () => {
  const terms = Hub.parseXqList(XQ_LIST_RAW);
  // 2025-10-25 落在 20252 学期内（JSRQ 2026-01-18 未到）→ 第 0 项(20252)即当前
  assert.strictEqual(Hub.pickCurrentTerm(terms, '2025-10-25').term, '20252');
  // 2026-03-01：20252 已结束（01-18），下一个学期应为其「前一项」语义——列表新在前，
  // 第一个 JSRQ≤today 的是 index2(20232, 结束于 2024-06-30) → 取 index1(20252)？不：
  // 20252 结束于 2026-01-18 ≤ 2026-03-01 → picked = terms[0](20252)？按注入逻辑取 terms[i-1]。
  // index2 的 JSRQ=2024-06-30 ≤ today → picked = terms[1] = 20252。
  assert.strictEqual(Hub.pickCurrentTerm(terms, '2026-03-01').term, '20252');
  assert.strictEqual(Hub.pickCurrentTerm(terms, '2024-05-01').term, '20232'); // 20232 学期内
  // 全部学期 JSRQ > today 时取第 0 项（注入逻辑原语义：列表只含过去+当前学期）
  assert.strictEqual(Hub.pickCurrentTerm(terms, '2023-05-01').term, '20252');
});

test('hub: 请求参数构造（URL/学期号校验/Referer）', () => {
  const r = Hub.courseRequest('20232');
  assert.strictEqual(r.url, 'https://mhub.hust.edu.cn/LsController/findNameCourse?kcbxqh=20232');
  assert.strictEqual(r.fallbackUrl.startsWith('http://mhub.hust.edu.cn/'), true);
  assert.strictEqual(r.headers.Referer.includes('/kbPageController/by-course'), true);
  assert.throws(() => Hub.courseRequest('2023'), /5 位数字/);
  assert.throws(() => Hub.courseRequest(null), /5 位数字/);
  const xq = Hub.xqListRequest();
  assert.strictEqual(xq.url, 'https://mhub.hust.edu.cn/CommonController/getXqList');
});

// ---- 课表解析 ----

test('hub: 课表字段映射与 CAMPUSER 结构（聚合/排序/位串/termStart）', () => {
  const r = Hub.parseCourse(COURSE_RAW);
  assert.strictEqual(r.scheduleName, '2023-2024学年第二学期');
  assert.strictEqual(r.termStart, '2024-02-26'); // 周一，第1周起点
  assert.strictEqual(r.totalWeeks, 18); // max(JSZC=16, JSRQ 推算 06-30 在第 18 周)
  assert.strictEqual(r.warnings.length, 1);
  assert.match(r.warnings[0], /节次缺失课程/);
  assert.strictEqual(r.courses.length, 5); // 脏数据课程被完全忽略

  // 中国近现代史纲要：单时间段，1-16 周 1-2 节
  const marx = r.courses.find((c) => c.name === '中国近现代史纲要');
  assert.strictEqual(marx.timeSlots.length, 1);
  const sl = marx.timeSlots[0];
  assert.strictEqual(sl.day, 5);
  assert.strictEqual(sl.start, 1);
  assert.strictEqual(sl.step, 2);
  assert.strictEqual(sl.startWeek, 1);
  assert.strictEqual(sl.endWeek, 16);
  assert.strictEqual(sl.weeks, '1'.repeat(16)); // 连续 16 周位串
  assert.strictEqual(sl.room, '西十二楼N111');
  assert.strictEqual(sl.teach, '魏维');
  assert.strictEqual(sl.isOdd, 0);
  assert.strictEqual(sl.customTime, null);

  // 物理实验：两条 tr → 同一课堂聚合为 2 个时间段（教师/教室为 null → 空串）
  const pe = r.courses.find((c) => c.name === '物理实验（一）');
  assert.strictEqual(pe.timeSlots.length, 2);
  assert.strictEqual(pe.timeSlots[0].day, 2);
  assert.strictEqual(pe.timeSlots[1].day, 4);
  assert.strictEqual(pe.timeSlots[0].room, '');
  assert.strictEqual(pe.timeSlots[0].teach, '');
  assert.strictEqual(pe.timeSlots[0].weeks, '1'); // 仅第 1 周
  assert.strictEqual(pe.timeSlots[1].weeks, '01111111'); // 2..8 周

  // 综合英语：同一课堂两段，按 day 排序（周二 5-6 节在前）
  const eng = r.courses.find((c) => c.name === '综合英语（二）');
  assert.strictEqual(eng.timeSlots.length, 2);
  assert.strictEqual(eng.timeSlots[0].day, 2);
  assert.strictEqual(eng.timeSlots[0].start, 5);
  assert.strictEqual(eng.timeSlots[1].day, 5);
  assert.strictEqual(eng.timeSlots[1].start, 3);

  // 9-12 节 → start 9 step 4
  const cn = r.courses.find((c) => c.name.startsWith('中国语文'));
  assert.strictEqual(cn.timeSlots[0].start, 9);
  assert.strictEqual(cn.timeSlots[0].step, 2);

  // 课堂名（KTMC ≠ 课程名）进 note
  assert.strictEqual(marx.note, '课堂: 计算机类（一）2311-2312');
  assert.strictEqual(pe.note, '课堂: 计算机类（一）2307-2312');

  // 所有课可被 normalizeSchedule 直接吸收（颜色自动、结构合法）
  assert.ok(r.courses.every((c) => Array.isArray(c.timeSlots) && c.timeSlots.length > 0));
});

test('hub: courseList 直接为数组的变体同样解析', () => {
  const raw = JSON.stringify({
    termInfo: { XQH: '20232', XQMC: 'S', QSRQ: '2024-02-26', JSRQ: '2024-06-30' },
    courseList: [{ KTBH: 'c1', KCMC: '课A', tr: [{ XQS: '1', QSZC: '1', JSZC: '8', QSJC: '1', JSJC: '2' }] }],
  });
  const r = Hub.parseCourse(raw);
  assert.strictEqual(r.courses.length, 1);
  assert.strictEqual(r.courses[0].timeSlots[0].weeks, '11111111');
});

test('hub: 周日防御（XQS=0 视为周日 7）', () => {
  const raw = JSON.stringify({
    termInfo: { XQH: '20232', XQMC: 'S', QSRQ: '2024-02-26', JSRQ: '2024-06-30' },
    courseList: [{ KTBH: 'c1', KCMC: '周日课', tr: [{ XQS: '0', QSZC: '1', JSZC: '8', QSJC: '1', JSJC: '2' }] }],
  });
  const r = Hub.parseCourse(raw);
  assert.strictEqual(r.courses[0].timeSlots[0].day, 7);
});

test('hub: QSRQ 缺失 / courseList 空 / 全部脏数据 → 明确报错', () => {
  assert.throws(() => Hub.parseCourse(JSON.stringify({ termInfo: { XQH: '20232' }, courseList: { data: [] } })), /QSRQ/);
  assert.throws(() => Hub.parseCourse(JSON.stringify({ termInfo: { XQH: '20232', QSRQ: '2024-02-26' }, courseList: { data: [] } })), /courseList 为空/);
  const allDirty = JSON.stringify({
    termInfo: { XQH: '20232', XQMC: 'S', QSRQ: '2024-02-26', JSRQ: '2024-06-30' },
    courseList: [{ KTBH: 'c1', KCMC: '脏', tr: [{ XQS: '1', QSZC: '1', JSZC: '8', QSJC: '1', JSJC: null }] }],
  });
  assert.throws(() => Hub.parseCourse(allDirty), /无有效课程/);
});

test('hub: 登录页 HTML 响应 → 报 Cookie 失效语义错误', () => {
  assert.throws(() => Hub.parseCourse('<!DOCTYPE html><html>统一身份认证登录</html>'), /不是合法 JSON/);
});

test('hub: weeksToBits 边界', () => {
  assert.strictEqual(Hub.weeksToBits(1, 1), '1');
  assert.strictEqual(Hub.weeksToBits(3, 8), '00111111');
  assert.strictEqual(Hub.weeksToBits(2, 2), '01');
});
