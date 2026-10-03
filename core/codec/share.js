/*!
 * WakeUp 课程表本地版 · 领域内核：QR 码 / 文本口令编解码
 * 离线版"分享口令"：单表分享 JSON → deflate 压缩 → base64url，
 * 前缀 WU1:（压缩）/ WU0:（原文，压缩不可用时降级）。
 * 全程无网络：传输介质是屏幕（QR）与剪贴板（口令）。
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { Backup: require('./backup.js') }
    : { Backup: root.WakeupBackupCodec };
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WakeupShareCodec = api;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { Backup } = deps;

  // QR 码 byte 模式容量上限（版本 40, 纠错 L）约 2953 字节，留安全余量
  const MAX_CODE_LENGTH = 2900;

  function bytesToB64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64UrlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deflateBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }

  async function inflateBytes(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }

  // schedule → 'WU1:…' / 'WU0:…'
  async function encodeShare(schedule) {
    const json = Backup.serializeShare(schedule);
    const raw = new TextEncoder().encode(json);
    const def = await deflateBytes(raw);
    let prefix, payload;
    if (def && def.length < raw.length) {
      prefix = 'WU1:';
      payload = def;
    } else {
      prefix = 'WU0:';
      payload = raw;
    }
    const code = prefix + bytesToB64Url(payload);
    if (code.length > MAX_CODE_LENGTH) {
      return { error: '课程数据过大，无法生成口令，请改用文件分享' };
    }
    return { code };
  }

  // 'WU1:…' / 'WU0:…' → {schedule} | {error}
  async function decodeShare(code) {
    const s = String(code || '').trim();
    let compressed;
    if (s.startsWith('WU1:')) compressed = true;
    else if (s.startsWith('WU0:')) compressed = false;
    else return { error: '口令格式不正确（应以 WU1: 或 WU0: 开头）' };

    let bytes;
    try { bytes = b64UrlToBytes(s.slice(4)); }
    catch (e) { return { error: '口令内容无效' }; }

    let json;
    if (compressed) {
      const out = await inflateBytes(bytes);
      if (!out) return { error: '当前环境不支持解压该口令' };
      json = new TextDecoder().decode(out);
    } else {
      json = new TextDecoder().decode(bytes);
    }

    const r = Backup.parseShare(json);
    if (r.error) return { error: '口令数据无效：' + r.error };
    return { schedule: r.schedule };
  }

  return { MAX_CODE_LENGTH, encodeShare, decodeShare };
});
