// campuser · Electron file storage. Keep the primary file intact until rename succeeds.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseSnapshot } = require('../core/persistence');

function createFileStorage(file, io = fs) {
  function read(name) {
    try { return io.readFileSync(name, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function atomicWrite(name, text) {
    const temp = name + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fd = io.openSync(temp, 'wx', 0o600);
      io.writeFileSync(fd, text, 'utf8');
      io.fsyncSync(fd);
      io.closeSync(fd); fd = undefined;
      io.renameSync(temp, name);
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      try { io.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return {
    load: () => ({ text: read(file), backup: read(file + '.bak') }),
    save(text, { expected } = {}) {
      parseSnapshot(text);
      const previous = read(file);
      if (previous !== expected) throw new Error('数据已被其他窗口修改，请先导出当前修改，再重新加载');
      io.mkdirSync(path.dirname(file), { recursive: true });
      if (previous !== null) {
        let valid = true;
        try { parseSnapshot(previous); } catch { valid = false; }
        if (valid) atomicWrite(file + '.bak', previous);
        else atomicWrite(file + '.corrupt-' + randomUUID(), previous);
      } else if (read(file + '.bak') === null) {
        atomicWrite(file + '.bak', text);
      }
      atomicWrite(file, text);
      return true;
    }
  };
}
module.exports = { createFileStorage };
