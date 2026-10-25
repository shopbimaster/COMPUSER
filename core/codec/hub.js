/*!
 * CampUser 教务导入模块 · 华中科技大学（HUB 系统，mhub.hust.edu.cn）
 * 纯函数零平台依赖：只做「响应文本 → CAMPUSER 课表结构」的解析与「请求参数」的构造。
 *
 * 接口协议（复刻自 Hustoday v1.5.0 逆向，与开源 hust2ics 实测一致）：
 *   GET /CommonController/getXqList                    → 学期列表（数组或 {data:[...]}）
 *   GET /LsController/findNameCourse?kcbxqh=<5位学期号> → 课表 {termInfo, courseList:{data:[...]}}
 *   认证：浏览器登录 mhub 后的 Cookie 头原样携带（App 依赖系统共享 Cookie，无自定义 UA/Pinning）；
 *   401/403 = Cookie 失效；响应为登录页 HTML 时 JSON 解析失败 → 视为未登录。
 *
 * 课表 JSON 字段（教务原始缩写）：
 *   termInfo: XQH(学期号5位) XQMC(学期名) QSRQ(学期起始日=第1周周一) JSRQ(结束日)
 *   courseList.data[]: KTBH(课堂号) KTMC(课堂名) KCMC(课程名) XQH
 *     tr[]: XM(教师) XQS(星期1-7) QSZC/JSZC(起止周，连续区间) QSJC/JSJC(起止节) JSMC(教室)
 *   无单双周概念（周次为连续区间）；endSection 缺失的排课丢弃并记入 warnings（与官方 App 一致）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampuserHub = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE_HTTPS = 'https://mhub.hust.edu.cn';
  const BASE_HTTP = 'http://mhub.hust.edu.cn';
  const REFERER = BASE_HTTPS + '/kbPageController/by-course';

  class HubError extends Error {}

  // ---------- 请求构造（纯函数，便于离线测试参数正确性） ----------

  function xqListRequest() {
    return { url: BASE_HTTPS + '/CommonController/getXqList', fallbackUrl: BASE_HTTP + '/CommonController/getXqList', headers: { Referer: REFERER } };
  }

  function courseRequest(term) {
    const t = String(term == null ? '' : term).trim();
    if (!/^\d{5}$/.test(t)) throw new HubError('学期号应为 5 位数字（如 20252），收到: ' + term);
    const qs = '?kcbxqh=' + encodeURIComponent(t);
    return { url: BASE_HTTPS + '/LsController/findNameCourse' + qs, fallbackUrl: BASE_HTTP + '/LsController/findNameCourse' + qs, headers: { Referer: REFERER } };
  }

  // ---------- JSON 解析（容错：登录页跳转会返回 HTML） ----------

  function parseJson(text, what) {
    try {
      return JSON.parse(text);
    } catch (e) {
      const snippet = String(text || '').slice(0, 120).replace(/\s+/g, ' ');
      throw new HubError((what || '响应') + '不是合法 JSON（可能 Cookie 失效跳转了登录页）: ' + snippet);
    }
  }

  // ---------- 学期列表 ----------

  /** 学期列表响应 → [{term:'20232', name:'2023-2024学年第二学期', startDate, endDate}]（剔除占位项） */
  function parseXqList(text) {
    let data = parseJson(text, '学期列表');
    if (data && typeof data === 'object' && !Array.isArray(data)) data = data.data || [];
    if (!Array.isArray(data)) throw new HubError('学期列表结构异常: ' + typeof data);
    return data
      .filter((t) => t && t.XQH)
      .map((t) => ({ term: String(t.XQH), name: t.XQMC || String(t.XQH), startDate: (t.QSRQ || '').slice(0, 10), endDate: (t.JSRQ || '').slice(0, 10) }));
  }

  /** 与注入脚本同款选学期逻辑：列表新学期在前，跳过第 0 项，第一个 JSRQ≤today 的前一项为当前学期 */
  function pickCurrentTerm(terms, todayIso) {
    if (!terms || !terms.length) return null;
    if (terms.length === 1) return terms[0];
    const today = String(todayIso || '');
    let picked = terms[0];
    for (let i = 1; i < terms.length; i++) {
      const end = (terms[i].endDate || '').slice(0, 10);
      if (end && end <= today) {
        picked = terms[i - 1];
        break;
      }
    }
    if (!picked.term) picked = terms.find((t) => t.term) || picked;
    return picked;
  }

  // ---------- 数字字段容错解析 ----------

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(String(v).trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  // ---------- 周次连续区间 → 位串（index0=第1周，长度=末周） ----------

  function weeksToBits(startWeek, endWeek) {
    const len = endWeek;
    let s = '';
    for (let i = 1; i <= len; i++) s += i >= startWeek ? '1' : '0';
    return s;
  }

  // ---------- 课表解析 → CAMPUSER v2 结构 ----------

  /**
   * findNameCourse 响应 → {
   *   warnings: string[],        // 被忽略的脏排课说明
   *   scheduleName: string,      // 学期名（建议新课表名）
   *   termStart: 'YYYY-MM-DD',   // 学期第1周周一（QSRQ）
   *   totalWeeks: number,        // 取所有课程最大 JSZC（至少覆盖 termInfo.JSRQ 推算）
   *   courses: [{ name, color: -1, credit: null, note: '', timeSlots: [...] }]
   * }（timeSlots 已按 day/start 排序；course 结构可直接并入 migrate/normalizeSchedule）
   */
  function parseCourse(text) {
    const data = parseJson(text, '课表');
    if (!data || typeof data !== 'object') throw new HubError('课表数据类型异常');
    const rawTerm = data.termInfo || {};
    const termStart = String(rawTerm.QSRQ || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(termStart)) throw new HubError('termInfo.QSRQ（学期起始日）缺失或格式非法');
    let list = data.courseList;
    if (list && !Array.isArray(list)) list = list.data || [];
    if (!Array.isArray(list) || !list.length) throw new HubError('courseList 为空（可能 Cookie 失效或该学期无课）');

    const warnings = [];
    let maxEndWeek = 0;
    // 按 KTBH（课堂号）聚合：同课堂多条 tr = 同一门课的多个时间段
    const byClass = new Map();
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const trs = Array.isArray(c.tr) ? c.tr : [];
      for (const tr of trs) {
        const start = num(tr && tr.QSJC);
        const end = num(tr && tr.JSJC);
        const day = num(tr && tr.XQS);
        const startWeek = num(tr && tr.QSZC);
        const endWeek = num(tr && tr.JSZC);
        const where = '[' + (c.KCMC || '(未命名课程)') + ']';
        const day7raw = day === 0 ? 7 : day; // 防御：0 视为周日（须在校验前归一，避免被 falsy 判空）
        if (!start || !end) {
          warnings.push('课程 ' + where + ' 节次信息缺失（QSJC=' + tr.QSJC + ', JSJC=' + tr.JSJC + '），已忽略该条排课');
          continue;
        }
        if (!day7raw || !startWeek || !endWeek) {
          warnings.push('课程 ' + where + ' 周/星期信息缺失，已忽略该条排课');
          continue;
        }
        if (endWeek > maxEndWeek) maxEndWeek = endWeek;
        const id = String(c.KTBH || c.KCMC || '(未编号)');
        if (!byClass.has(id)) {
          byClass.set(id, {
            name: c.KCMC || '(未命名课程)',
            className: c.KTMC || '',
            slots: [],
          });
        }
        byClass.get(id).slots.push({
          id: null,
          day: day7raw,
          start,
          step: Math.max(1, end - start + 1),
          weeks: weeksToBits(startWeek, endWeek),
          startWeek,
          endWeek,
          isOdd: 0,
          room: tr.JSMC || '',
          teach: tr.XM || '',
          customTime: null,
        });
      }
    }
    if (!byClass.size) throw new HubError('解析后无有效课程（全部排课被忽略）');

    const courses = [];
    for (const item of byClass.values()) {
      item.slots.sort((a, b) => a.day - b.day || a.start - b.start);
      courses.push({
        id: null,
        updatedAt: null,
        name: item.name,
        color: -1,
        credit: null,
        note: item.className && item.className !== item.name ? '课堂: ' + item.className : '',
        timeSlots: item.slots,
      });
    }
    courses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    // totalWeeks：取最大 JSZC，并吸收 termInfo.JSRQ 对应周数（JSRQ 可能晚于最后一课）
    let totalWeeks = Math.max(1, maxEndWeek);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(rawTerm.JSRQ || '').slice(0, 10))) {
      const ms = new Date(rawTerm.JSRQ.slice(0, 10) + 'T00:00:00') - new Date(termStart + 'T00:00:00');
      if (ms > 0) {
        const jsrqWeeks = Math.floor(ms / (7 * 86400000)) + 1;
        if (jsrqWeeks > totalWeeks) totalWeeks = jsrqWeeks;
      }
    }

    return {
      warnings,
      scheduleName: rawTerm.XQMC || '教务导入',
      termStart,
      totalWeeks,
      courses: courses.map((c) => ({ name: c.name, color: -1, credit: null, note: c.note, timeSlots: c.timeSlots })),
    };
  }

  return {
    HubError,
    BASE_HTTPS,
    xqListRequest,
    courseRequest,
    parseJson,
    parseXqList,
    pickCurrentTerm,
    parseCourse,
    weeksToBits,
  };
});
