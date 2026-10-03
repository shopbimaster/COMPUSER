/*!
 * WakeUp 课程表本地版 · 领域内核：LWW 合并引擎（纯函数，零平台依赖）
 * 为离线分享与未来 P2P 同步服务：双方各自 merge(local, remote)，
 * 无需服务器协调即可收敛到一致结果。
 *
 * 策略：
 *   - 课表(schedule)按 id 取并集；同 id 时表级字段（名称/设置）按 updatedAt LWW，
 *     内部课程再按课程级 LWW 逐门合并（并发编辑不同课程不互相覆盖）
 *   - 课程按 id 取并集，updatedAt 新者胜；平局本地胜（确定性）
 *   - 删除墓碑 tombstones[courseId] = 时间戳：删除晚于对方最后一次编辑 → 删除胜；
 *     对方编辑晚于删除 → 课程复活（更新胜）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WakeupMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mapById(list) {
    const m = {};
    for (const x of list) m[x.id] = x;
    return m;
  }

  function mergeSchedule(l, r) {
    // 表级字段（名称/设置/周次配置）：LWW
    const base = (Number(r.updatedAt) || 0) > (Number(l.updatedAt) || 0) ? r : l;

    // 墓碑合并：同名课程取较晚的删除时间
    const tombstones = {};
    for (const k of Object.keys(l.tombstones || {})) tombstones[k] = l.tombstones[k];
    for (const k of Object.keys(r.tombstones || {})) {
      tombstones[k] = Math.max(tombstones[k] || 0, r.tombstones[k]);
    }

    // 课程并集 + 课程级 LWW + 墓碑过滤
    const byIdL = mapById(l.courses || []);
    const byIdR = mapById(r.courses || []);
    const ids = [...new Set([...Object.keys(byIdL), ...Object.keys(byIdR)])];
    const courses = [];
    for (const id of ids) {
      const lc = byIdL[id], rc = byIdR[id];
      let winner;
      if (lc && rc) winner = (Number(rc.updatedAt) || 0) > (Number(lc.updatedAt) || 0) ? rc : lc;
      else winner = rc || lc;
      // 更新时间 >= 墓碑时间 → 存活（相等时偏向保留，避免同毫秒误删）
      if (winner && (Number(winner.updatedAt) || 0) >= (tombstones[id] || 0)) courses.push(winner);
    }

    return {
      id: l.id,
      name: base.name,
      updatedAt: Math.max(Number(l.updatedAt) || 0, Number(r.updatedAt) || 0),
      settings: base.settings,
      courses,
      tombstones
    };
  }

  function mergeState(local, remote) {
    const byIdL = mapById(local.schedules || []);
    const byIdR = mapById(remote.schedules || []);
    const ids = [...new Set([...Object.keys(byIdL), ...Object.keys(byIdR)])];
    const schedules = ids.map(id => {
      const l = byIdL[id], r = byIdR[id];
      if (l && r) return mergeSchedule(l, r);
      return r || l;
    });

    const out = {
      format: local.format,
      device: local.device,           // device/prefs 以本地为准
      prefs: local.prefs,
      updatedAt: Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0),
      currentScheduleId: local.currentScheduleId,
      schedules
    };
    if (!schedules.find(s => s.id === out.currentScheduleId)) {
      out.currentScheduleId = schedules.length ? schedules[0].id : null;
    }
    return out;
  }

  return { mergeState, mergeSchedule };
});
