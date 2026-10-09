/*!
 * CampUser 课程表模块 · 领域内核：CSV（Excel）导入导出
 * 还原原版"Excel 模板导入"：CSV 既是人可编辑的模板，也是程序可解析的数据。
 * 列：星期,开始节,结束节,开始周,结束周,周类型,课程名,教师,教室,颜色,学分,备注
 * 导入时按（课程名,颜色,学分,备注）聚合为多时间段课程。
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { Model: require('../model.js') }
    : { Model: root.CampuserModel };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampuserCsvCodec = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { Model } = deps;

  const HEADERS = ['星期', '开始节', '结束节', '开始周', '结束周', '周类型', '课程名', '教师', '教室', '颜色', '学分', '备注'];
  const DAY_NAMES = { '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 7, '周天': 7 };
  const ODD_NAMES = { '每周': 0, '单周': 1, '双周': 2 };

  function esc(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // 行数组 → CSV 文本
  function rowsToCsv(rows) {
    return rows.map(r => r.map(esc).join(',')).join('\r\n');
  }

  // CSV 文本 → 行数组（带引号感知的解析）
  function parseCsvLines(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const s = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  function parseDay(v) {
    if (v in DAY_NAMES) return DAY_NAMES[v];
    const n = Number(v);
    if (n >= 1 && n <= 7) return n;
    return null;
  }

  // 课表 → CSV 文本（带 BOM，Excel 直接打开不乱码）
  function toCsv(schedule) {
    const rows = [HEADERS];
    for (const c of schedule.courses) {
      for (const sl of c.timeSlots) {
        rows.push([
          Object.keys(DAY_NAMES).find(k => DAY_NAMES[k] === sl.day) || sl.day,
          sl.start, sl.start + sl.step - 1,
          sl.startWeek, sl.endWeek,
          ['每周', '单周', '双周'][sl.isOdd],
          c.name, sl.teach, sl.room,
          c.color, c.credit == null ? '' : c.credit, c.note
        ]);
      }
    }
    return '\uFEFF' + rowsToCsv(rows);
  }

  // CSV 文本 → {courses} | {error}
  function parseCsv(text) {
    const rows = parseCsvLines(text);
    if (!rows.length) return { error: 'CSV 文件为空' };

    // 定位表头（容忍列顺序变化）
    const header = rows[0].map(h => h.trim());
    const idx = {};
    for (const name of HEADERS) {
      const i = header.indexOf(name);
      if (i >= 0) idx[name] = i;
    }
    if (idx['课程名'] === undefined) return { error: 'CSV 缺少「课程名」列' };

    const get = (row, name) => (idx[name] !== undefined ? String(row[idx[name]] == null ? '' : row[idx[name]]).trim() : '');

    const groups = new Map(); // key: name|color|credit|note → course
    let skipped = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = get(row, '课程名');
      if (!name) { skipped++; continue; }
      const day = parseDay(get(row, '星期'));
      const start = Number(get(row, '开始节'));
      const end = Number(get(row, '结束节'));
      if (!day || !start || !end || end < start) { skipped++; continue; }
      let sw = Number(get(row, '开始周')) || 1;
      let ew = Number(get(row, '结束周')) || sw;
      if (ew < sw) { const t = sw; sw = ew; ew = t; }
      const oddName = get(row, '周类型');
      const isOdd = oddName in ODD_NAMES ? ODD_NAMES[oddName] : 0;

      const colorRaw = get(row, '颜色');
      const creditRaw = get(row, '学分');
      const note = get(row, '备注');
      const key = [name, colorRaw, creditRaw, note].join('\u0001');
      if (!groups.has(key)) {
        groups.set(key, {
          name, color: colorRaw, credit: creditRaw, note,
          _slots: []
        });
      }
      groups.get(key)._slots.push({
        day, start, step: end - start + 1,
        startWeek: sw, endWeek: ew, isOdd,
        room: get(row, '教室'), teach: get(row, '教师')
      });
    }

    if (!groups.size) return { error: '没有解析到有效课程行' + (skipped ? `（跳过 ${skipped} 行无效数据）` : '') };
    const courses = [...groups.values()].map(g => Model.normalizeCourse({
      name: g.name,
      color: g.color === '' ? -1 : g.color,
      credit: g.credit === '' ? null : Number(g.credit),
      note: g.note,
      timeSlots: g._slots
    }));
    return { courses, skipped };
  }

  return { HEADERS, toCsv, parseCsv };
});
