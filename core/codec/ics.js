/*!
 * CampUser 课程表模块 · 领域内核：iCal (.ics) 导出
 * 还原原版"导出 iCal 文件"：每个时间段一个 VEVENT，
 * RRULE=WEEKLY 按周重复（单双周 INTERVAL=2），含 VTIMEZONE（Asia/Shanghai）。
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
          'UID:' + c.id + '-' + sl.id + '@wakeup-local',
          'DTSTAMP:' + localDateTime(occ.firstDate, occ.startTime),
          'DTSTART;TZID=Asia/Shanghai:' + localDateTime(occ.firstDate, occ.startTime),
          'DTEND;TZID=Asia/Shanghai:' + localDateTime(occ.firstDate, occ.endTime),
          'RRULE:FREQ=WEEKLY;INTERVAL=' + interval + ';BYDAY=' + BYDAY[sl.day - 1] + ';UNTIL=' + localDateTime(occ.lastDate, occ.endTime),
          'SUMMARY:' + escText(c.name),
          'LOCATION:' + escText(sl.room),
          'DESCRIPTION:' + escText([
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

  return { toIcs };
});
