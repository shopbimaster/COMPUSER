/*!
 * CampUser 课程表模块 · 领域内核：备份与分享文件编解码（纯逻辑）
 *
 * 两种文件格式：
 *   完整备份  { format:'campuser-schedule/2', device, ..., schedules[] }
 *   单表分享  { format:'campuser-share/1', exportedAt, schedule }   ← 对应原版"分享课表"
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { Model: require('../model.js') }
    : { Model: root.CampuserModel };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampuserBackupCodec = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { Model } = deps;

  const BACKUP_FORMAT = 'campuser-schedule/2';
  const SHARE_FORMAT = 'campuser-share/1';

  // ---- 完整备份 ----
  function serialize(state) {
    return JSON.stringify(state, null, 2);
  }

  // ---- 单表分享 ----
  function serializeShare(schedule) {
    return JSON.stringify({
      format: SHARE_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      schedule
    }, null, 2);
  }

  // ---- 解析（自动识别备份 / 分享 / v1 旧备份） ----
  function parseAuto(text) {
    let raw;
    try { raw = JSON.parse(String(text)); } catch (e) {
      return { error: '不是有效的 JSON 文件' };
    }
    if (!raw || typeof raw !== 'object') return { error: '文件内容不是有效对象' };
    if (Array.isArray(raw.schedules)) {
      return { kind: 'backup', state: Model.normalizeState(raw) };
    }
    if (Array.isArray(raw.courses)) {
      return { kind: 'backup', state: Model.migrate(raw) }; // v1 旧备份自动迁移
    }
    if (raw.schedule && typeof raw.schedule === 'object') {
      return { kind: 'share', schedule: Model.normalizeSchedule(raw.schedule) };
    }
    return { error: '无法识别的文件格式' };
  }

  function parseBackup(text) {
    const r = parseAuto(text);
    if (r.error) return r;
    if (r.kind !== 'backup') return { error: '这是分享文件而非完整备份' };
    return r;
  }

  function parseShare(text) {
    const r = parseAuto(text);
    if (r.error) return r;
    if (r.kind !== 'share') return { error: '这是完整备份而非单表分享文件' };
    return r;
  }

  return { BACKUP_FORMAT, SHARE_FORMAT, serialize, serializeShare, parseAuto, parseBackup, parseShare };
});
