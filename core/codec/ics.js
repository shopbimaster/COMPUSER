/*!
 * CampUser 课程表模块 · 领域内核：iCal (.ics) 导出与导入
 * 导出：还原原版"导出 iCal 文件"——每个时间段一个 VEVENT，
 *       RRULE=WEEKLY 按周重复（单双周 INTERVAL=2），含 VTIMEZONE（Asia/Shanghai）。
 * 导入：兼容本应用与原版 WakeUpSchedule 的导出格式——
 *       节次优先取 DESCRIPTION「第X - Y节」（原版惯例），否则按默认时间表就近匹配；
 *       周次由 RRULE 展开出的实际上课日期按学期锚点反推（单双周由 INTERVAL 自然涌现）；
 *       学期开始日 = 最早事件所在周的周一。
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { Model: require('../model.js'), Week: require('../week.js'), Conflict: require('../conflict.js') }
    : { Model: root.CampuserModel, Week: root.CampuserWeek, Conflict: root.CampuserConflict };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampuserIcsCodec = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { Model, Week, Conflict } = deps;

  const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const CST_MS = 8 * 3600 * 1000; // Asia/Shanghai 固定 +08:00（无夏令时）

  function escText(v) {
    return String(v == null ? '' : v)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // 超过 75 字节的行折叠（RFC 5545）
  function fold(line) {
    const bytes = [];
    for (const ch of line) { // 按 UTF-16 码点粗略计数（中文按 3 字节计）
      bytes.push(ch.charCodeAt(0) > 0xff ? 3 : 1);
    }
    if (line.length <= 74) return line;
    const out = [];
    let len = 0, cur = '';
    for (let i = 0; i < line.length; i++) {
      const w = bytes[i];
      if (len + w > 74) { out.push(cur); cur = ' ' + line[i]; len = 1 + w; }
      else { cur += line[i]; len += w; }
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function localDateTime(date, hhmm) {
    return Week.fmtYmd(date) + 'T' + hhmm.replace(':', '') + '00';
  }

  // 时间段在该学期内的首次/末次上课日期与时刻
  function slotOccurrences(settings, sl) {
    let first = null, last = null;
    for (let w = sl.startWeek; w <= sl.endWeek; w++) {
      if (Conflict.slotInWeek(sl, w)) {
        if (!first) first = w;
        last = w;
      }
    }
    if (!first) return null;
    const startTime = sl.customTime ? sl.customTime.start : settings.times[Math.min(sl.start, settings.classNum) - 1].start;
    const endTime = sl.customTime ? sl.customTime.end : settings.times[Math.min(sl.start + sl.step - 1, settings.classNum) - 1].end;
    return {
      firstDate: Week.dayDate(settings.termStart, first, sl.day),
      lastDate: Week.dayDate(settings.termStart, last, sl.day),
      startTime, endTime
    };
  }

  function toIcs(schedule) {
    const s = schedule.settings;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CampUser//CN//',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escText(schedule.name),
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Shanghai',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0800',
      'TZOFFSETTO:+0800',
      'TZNAME:CST',
      'END:STANDARD',
      'END:VTIMEZONE'
    ];

    for (const c of schedule.courses) {
      for (const sl of c.timeSlots) {
        const occ = slotOccurrences(s, sl);
        if (!occ) continue;
        const interval = sl.isOdd ? 2 : 1;
        lines.push(
          'BEGIN:VEVENT',
          'UID:' + c.id + '-' + sl.id + '@campuser',
          'DTSTAMP:' + localDateTime(occ.firstDate, occ.startTime),
          'DTSTART;TZID=Asia/Shanghai:' + localDateTime(occ.firstDate, occ.startTime),
          'DTEND;TZID=Asia/Shanghai:' + localDateTime(occ.firstDate, occ.endTime),
          'RRULE:FREQ=WEEKLY;INTERVAL=' + interval + ';BYDAY=' + BYDAY[sl.day - 1] + ';UNTIL=' + localDateTime(occ.lastDate, occ.endTime),
          'SUMMARY:' + escText(c.name),
          'LOCATION:' + escText(sl.room),
          'DESCRIPTION:' + escText([
            `第${sl.start} - ${sl.start + sl.step - 1}节`,
            sl.teach ? '教师：' + sl.teach : '',
            `周次：第${sl.startWeek}~${sl.endWeek}周（${['每周', '单周', '双周'][sl.isOdd]}）`,
            c.credit ? '学分：' + c.credit : '',
            c.note ? '备注：' + c.note : ''
          ].filter(Boolean).join('\n')),
          'END:VEVENT'
        );
      }
    }

    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ==================== 导入（parseIcs） ====================

  const pad2 = (n) => String(n).padStart(2, '0');
  const OCC_LIMIT = 60; // RRULE 无 UNTIL/COUNT 时的出现次数上限

  // 展开 RFC 5545 折行（续行以空格/制表符开头）
  function unfoldLines(text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .reduce((acc, line) => {
        if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length) {
          acc[acc.length - 1] += line.slice(1);
        } else if (line.trim() !== '') acc.push(line);
        return acc;
      }, []);
  }

  // 反转义 TEXT 值（与 escText 对应；单趟处理避免 \n 误伤 \\）
  function unescText(v) {
    return String(v == null ? '' : v).replace(/\\(.)/g, (m, c) => (c === 'n' || c === 'N') ? '\n' : c);
  }

  // iCal 日期时间 → { d:'YYYY-MM-DD', t:'HH:MM' }；Z 结尾（UTC）→ +08:00 本地化
  function parseIcsDateTime(v) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(String(v).trim());
    if (!m) return null;
    let [, y, mo, d, h, mi, s, z] = m;
    h = h || '00'; mi = mi || '00';
    if (z) {
      const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) + CST_MS);
      y = String(dt.getUTCFullYear());
      mo = pad2(dt.getUTCMonth() + 1); d = pad2(dt.getUTCDate());
      h = pad2(dt.getUTCHours()); mi = pad2(dt.getUTCMinutes());
    }
    return { d: `${y}-${mo}-${d}`, t: `${h}:${mi}` };
  }

  // RRULE 参数（仅支持 FREQ=WEEKLY；其余频率按单次事件处理）
  function parseRrule(v) {
    const parts = {};
    String(v).split(';').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) parts[kv.slice(0, i).trim().toUpperCase()] = kv.slice(i + 1).trim();
    });
    if ((parts.FREQ || '').toUpperCase() !== 'WEEKLY') return null;
    const r = { interval: Math.max(1, Number(parts.INTERVAL) || 1), until: null, count: Math.min(OCC_LIMIT, Number(parts.COUNT) || OCC_LIMIT) };
    if (parts.UNTIL) r.until = parseIcsDateTime(parts.UNTIL);
    return r;
  }

  // 逐行收集：日历名 + VEVENT 顶层属性（忽略 VALARM 等子组件）
  function collectEvents(lines) {
    const events = [];
    let calName = '', stack = [], cur = null;
    for (const line of lines) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const left = line.slice(0, i);
      const value = line.slice(i + 1);
      const name = left.split(';')[0].trim().toUpperCase();
      if (name === 'BEGIN') {
        const comp = value.trim().toUpperCase();
        stack.push(comp);
        if (comp === 'VEVENT') cur = { props: {} };
        continue;
      }
      if (name === 'END') {
        const comp = value.trim().toUpperCase();
        if (comp === 'VEVENT' && cur) { events.push(cur); cur = null; }
        stack.pop();
        continue;
      }
      if (!cur) {
        if (name === 'X-WR-CALNAME') calName = unescText(value).trim();
        continue;
      }
      if (stack[stack.length - 1] !== 'VEVENT') continue; // VEVENT 子组件（VALARM 等）
      if (['SUMMARY', 'LOCATION', 'DESCRIPTION', 'DTSTART', 'DTEND', 'RRULE'].includes(name)) {
        cur.props[name] = value;
      }
    }
    return { events, calName };
  }

  // DESCRIPTION 解析：节次（原版惯例「第X - Y节」）、教师、学分、备注
  function parseDescription(desc) {
    const out = { start: 0, step: 0, teach: '', credit: null, note: '' };
    if (!desc) return out;
    const pm = /第\s*(\d+)\s*[-–—~]\s*(\d+)\s*节/.exec(desc);
    if (pm) { out.start = +pm[1]; out.step = Math.max(1, +pm[2] - (+pm[1]) + 1); }
    const tm = /教师[:：]\s*([^\n]+)/.exec(desc); if (tm) out.teach = tm[1].trim();
    const cm = /学分[:：]\s*(\d+(?:\.\d+)?)/.exec(desc); if (cm) out.credit = Number(cm[1]);
    const nm = /备注[:：]\s*([^\n]+)/.exec(desc); if (nm) out.note = nm[1].trim();
    return out;
  }

  // 无「第X节」提示时，按默认时间表就近匹配节次（本应用导出且未自定义时间表时精确命中）
  function periodFromTimes(startTime, endTime) {
    const st = Week.toMinutes(startTime);
    const en = endTime ? Week.toMinutes(endTime) : st + 45;
    let pi = 0, best = Infinity;
    for (let i = 0; i < Model.DEFAULT_TIMES.length; i++) {
      const d = Math.abs(Week.toMinutes(Model.DEFAULT_TIMES[i][0]) - st);
      if (d < best) { best = d; pi = i; }
    }
    let j = pi;
    while (j + 1 < Model.DEFAULT_TIMES.length && Week.toMinutes(Model.DEFAULT_TIMES[j][1]) < en) j++;
    return { start: pi + 1, step: j - pi + 1 };
  }

  // 展开 RRULE 为自首次上课日起的出现日期数组（UNTIL 含时刻比较）
  function expandOccurrences(firstDate, firstTime, rrule) {
    const first = Week.parseDate(firstDate);
    const firstMin = Week.toMinutes(firstTime);
    const until = rrule && rrule.until
      ? { date: Week.parseDate(rrule.until.d), min: Week.toMinutes(rrule.until.t) }
      : null;
    const out = [];
    const n = rrule ? rrule.count : 1;
    for (let k = 0; k < n; k++) {
      const occ = Week.addDays(first, 7 * k * (rrule ? rrule.interval : 1));
      if (until) {
        if (occ > until.date) break;
        if (+occ === +until.date && firstMin > until.min) break;
      }
      out.push(occ);
    }
    return out;
  }

  // 出现周集合 → 位串（长度 = 最大周）
  function weeksBitstring(weekNums) {
    const max = Math.max.apply(null, weekNums);
    let s = '';
    for (let w = 1; w <= max; w++) s += weekNums.includes(w) ? '1' : '0';
    return s;
  }

  // 位串并集（补齐长度后按位 OR）——合并完全相同时间段的不连续片段
  function orWeeks(a, b) {
    const n = Math.max(a.length, b.length);
    let s = '';
    for (let i = 0; i < n; i++) s += (a.charAt(i) === '1' || b.charAt(i) === '1') ? '1' : '0';
    return s;
  }

  // ICS 文本 → { schedule, stats } | { error }
  // fallbackName：无 X-WR-CALNAME 时的课表名（文件名）
  // opts.courseFormat：与节次时间表精确匹配的日程去除自定义时间，存为课程格式
  //                   （跟随「上课时间」设置统一变更）；stats 返回匹配统计供 UI 询问
  function parseIcs(text, fallbackName, opts = {}) {
    const { events, calName } = collectEvents(unfoldLines(text));
    if (!events.length) return { error: '未找到课程事件（不是课程表 ICS 文件）' };

    // 第一遍：VEVENT → slot 雏形（保留出现日期数组，termStart 未定时先不折算周次）
    const slots = [];
    let minDate = null, maxPeriod = 0;
    for (const ev of events) {
      const p = ev.props;
      if (!p.DTSTART || !p.SUMMARY) continue;
      const ds = parseIcsDateTime(p.DTSTART);
      if (!ds || !ds.t) continue;
      const name = unescText(p.SUMMARY).trim();
      if (!name) continue;
      const de = p.DTEND ? parseIcsDateTime(p.DTEND) : null;
      const rrule = p.RRULE ? parseRrule(p.RRULE) : null;
      const occs = expandOccurrences(ds.d, ds.t, rrule);
      if (!occs.length) continue;

      const dinfo = parseDescription(unescText(p.DESCRIPTION || ''));
      let start = dinfo.start, step = dinfo.step;
      if (!start) {
        const fb = periodFromTimes(ds.t, de && de.t);
        start = fb.start; step = fb.step;
      }
      const first = Week.parseDate(ds.d);
      if (!minDate || first < minDate) minDate = first;
      maxPeriod = Math.max(maxPeriod, start + step - 1);

      slots.push({
        name,
        credit: dinfo.credit,
        note: dinfo.note,
        day: Week.mondayIndex(first) + 1,
        start, step,
        occs,
        room: unescText(p.LOCATION || '').trim(),
        teach: dinfo.teach,
        customTime: de && de.t ? { start: ds.t, end: de.t } : null
      });
    }
    if (!slots.length) return { error: '未找到有效课程事件' };

    // 学期锚点：最早事件所在周的周一（该周记为第 1 周）；由此统一折算周次
    const termStart = Week.fmtDate(Week.addDays(minDate, -Week.mondayIndex(minDate)));
    let maxWeek = 1;
    const timesObs = {}; // period → {start,end} 观测值（首个生效）
    for (const sl of slots) {
      sl.weeks = weeksBitstring(sl.occs.map((o) => Week.weekOfDate(termStart, o)));
      maxWeek = Math.max(maxWeek, sl.weeks.length);
      if (sl.customTime) {
        if (!timesObs[sl.start]) timesObs[sl.start] = {};
        if (!timesObs[sl.start].start) timesObs[sl.start].start = sl.customTime.start;
        const endP = sl.start + sl.step - 1;
        if (!timesObs[endP]) timesObs[endP] = {};
        if (!timesObs[endP].end) timesObs[endP].end = sl.customTime.end;
      }
    }

    // 同课程聚合（同名同学分同备注）；完全相同的时间段合并周次集合
    const groups = new Map(); // key → {name,credit,note, slots:[]}
    for (const sl of slots) {
      const key = [sl.name, sl.credit, sl.note].join('\u0001');
      if (!groups.has(key)) groups.set(key, { name: sl.name, credit: sl.credit, note: sl.note, slots: [] });
      const g = groups.get(key);
      const dup = g.slots.find((t) =>
        t.day === sl.day && t.start === sl.start && t.step === sl.step &&
        t.room === sl.room && t.teach === sl.teach &&
        JSON.stringify(t.customTime) === JSON.stringify(sl.customTime));
      if (dup) dup.weeks = orWeeks(dup.weeks, sl.weeks);
      else g.slots.push(sl);
    }

    // 上课时间表：观测值优先，缺省补默认（仅作网格刻度展示，真实时刻在各 slot 的 customTime）
    const classNum = Math.max(11, maxPeriod);
    const times = [];
    for (let i = 1; i <= classNum; i++) {
      const obs = timesObs[i] || {};
      const def = Model.DEFAULT_TIMES[Math.min(i - 1, Model.DEFAULT_TIMES.length - 1)];
      times.push({ start: obs.start || def[0], end: obs.end || def[1] });
    }

    // ICS 不含颜色信息：按随机池顺序分配不重复的颜色（课程多于池长时循环）
    const pool = Model.RANDOM_COLORS;
    let ci = 0;
    const courses = [...groups.values()].map((g) => Model.normalizeCourse({
      name: g.name,
      color: pool[ci++ % pool.length],
      credit: g.credit,
      note: g.note,
      timeSlots: g.slots.map((s) => ({
        day: s.day, start: s.start, step: s.step, weeks: s.weeks,
        room: s.room, teach: s.teach, customTime: s.customTime
      }))
    }));

    // 与分节时间表精确匹配的判定：起止时刻 == 所在节区间的起止
    const matchesTable = (sl) => {
      if (!sl.customTime) return true; // 已是课程格式
      const stT = times[Math.min(sl.start, classNum) - 1];
      const enT = times[Math.min(sl.start + sl.step - 1, classNum) - 1];
      return stT.start === sl.customTime.start && enT.end === sl.customTime.end;
    };
    let total = 0, matched = 0;
    for (const c of courses) {
      for (const sl of c.timeSlots) {
        total++;
        if (matchesTable(sl)) matched++;
      }
    }
    if (opts.courseFormat) {
      for (const c of courses) {
        for (const sl of c.timeSlots) {
          if (sl.customTime && matchesTable(sl)) sl.customTime = null;
        }
      }
    }

    const baseName = String(fallbackName || '').replace(/\.ics$/i, '').trim();
    const schedule = Model.normalizeSchedule({
      name: calName || baseName || '导入课表',
      settings: {
        termStart,
        totalWeeks: Math.max(1, maxWeek),
        classNum,
        times
      },
      courses
    });
    return { schedule, stats: { total, matched } };
  }

  return { toIcs, parseIcs };
});
