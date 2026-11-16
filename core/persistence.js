/* campuser · snapshot validation, recovery and ordered persistence (no platform APIs). */
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./model') : root.CampuserModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampuserPersistence = api;
})(typeof self !== 'undefined' ? self : this, function (Model) {
  'use strict';
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function parseSnapshot(text) {
    const raw = JSON.parse(text);
    if (!object(raw)) throw new Error('课表数据不是有效对象');
    if (raw.format != null && raw.format !== Model.FORMAT) {
      const error = new Error('不支持的数据版本，请使用对应版本的 campuser 打开');
      error.code = 'UNSUPPORTED_FORMAT';
      throw error;
    }
    if (Array.isArray(raw.schedules)) {
      if (!raw.schedules.length || !raw.schedules.every(s => object(s) &&
        Array.isArray(s.courses) && s.courses.every(c => object(c) &&
          Array.isArray(c.timeSlots) && c.timeSlots.length && c.timeSlots.every(object)))) {
        throw new Error('课表或课程时间段结构损坏');
      }
    } else if (!Array.isArray(raw.courses) || !raw.courses.every(object) || raw.format != null) {
      throw new Error('无法识别的本地课表格式');
    }
    return raw;
  }

  function createPersistence(storage) {
    let expected = null, loaded = false, tail = Promise.resolve(), pending = 0, dirty = false;
    return {
      get unsettled() { return pending > 0 || dirty; },
      async load() {
        loaded = false;
        const result = await storage.load(); // I/O errors must never become a new empty schedule.
        const snapshot = typeof result === 'string' || result == null ? { text: result, backup: null } : result;
        expected = snapshot.text ?? null;
        let raw, recovered = false;
        if (expected == null && snapshot.backup == null) raw = null;
        else {
          try {
            if (expected == null) throw new Error('主数据文件缺失');
            raw = parseSnapshot(expected);
          } catch (error) {
            if (error.code === 'UNSUPPORTED_FORMAT') throw error;
            if (snapshot.backup == null) throw new Error('课表无法读取，原始数据已保留：' + error.message);
            try { raw = parseSnapshot(snapshot.backup); }
            catch (backupError) { throw new Error('主数据和自动备份均无法读取；原始数据已保留：' + backupError.message); }
            recovered = true;
          }
        }
        const state = Model.migrate(raw);
        loaded = true;
        return { state, recovered, migrated: !!raw && !raw.schedules };
      },
      save(state) {
        // Capture at invocation time, not when a queued write eventually runs.
        let text;
        try {
          if (!loaded) throw new Error('尚未成功读取原始数据，禁止覆盖');
          text = JSON.stringify(state, null, 2);
          parseSnapshot(text);
        } catch (error) { dirty = true; return Promise.reject(error); }
        pending++;
        dirty = true;
        const task = tail.then(async () => {
          await storage.save(text, { expected });
          expected = text;
          dirty = false;
        }).catch(error => { dirty = true; throw error; }).finally(() => { pending--; });
        tail = task.catch(() => {}); // A failed write must not poison subsequent retries.
        return task;
      }
    };
  }
  return { parseSnapshot, createPersistence };
});
