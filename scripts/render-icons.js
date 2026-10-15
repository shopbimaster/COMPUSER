// CAMPUSER 图标生成：图标/app2.svg（矢量）→ 白色圆角底组合 → 各平台全套尺寸
// 用法：npx electron scripts/render-icons.js
// 产物：
//   build/icon.png            1024 圆角底（electron-builder → exe/安装包/快捷方式 ico 源）
//   src/assets/icon.png        512 圆角底（BrowserWindow / 任务栏 / favicon）
//   src-tauri/icons/icon.png  1024 圆角底（Tauri 桌面 bundle）
//   release/android-icons/     Android 五密度 launcher 图（android init 后拷入 gen/android res）
//     mipmap-*/ic_launcher.png          圆角底（pre-26 传统启动器）
//     mipmap-*/ic_launcher_round.png    圆底（pre-26 圆形启动器）
//     drawable-*/ic_launcher_foreground.png  透明底（自适应图标前景层，66% 安全区）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// app2 图形内容（剥离根 svg 标签，保留 defs + 内容，供嵌套复用）
const app2 = fs.readFileSync(path.join(ROOT, '图标', 'app2.svg'), 'utf-8');
const glyph = app2.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// app2 内容包围盒（329 坐标系，已计入根 g 的 translate(0,-48)）：
// x 28..301（273 宽），y 86.95..253（166.05 高）
const GW = 273, GH = 166.05, GX = 28, GY = 86.95;

function svgCompose(size, pct, bg) {
  const gw = size * pct, gh = gw * (GH / GW);
  const x = (size - gw) / 2, y = (size - gh) / 2;
  const plate =
    bg === 'rounded'
      ? `<rect width="${size}" height="${size}" rx="${(size * 0.224).toFixed(1)}" fill="#FFFFFF"/>`
      : bg === 'circle'
        ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#FFFFFF"/>`
        : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    plate +
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${gw.toFixed(1)}" height="${gh.toFixed(1)}" viewBox="${GX} ${GY} ${GW} ${GH}">${glyph}</svg>` +
    `</svg>`
  );
}

// RGBA（canvas 顺序，自顶向下）→ ICO 的 DIB 帧：BITMAPINFOHEADER + BGRA（自底向上）+ AND mask
function rgbaToDib(rgba, w, h) {
  const maskRow = ((w + 31) >> 5) << 2; // mask 行按 32bit 对齐
  const pxSize = w * h * 4;
  const maskSize = maskRow * h;
  const buf = Buffer.alloc(40 + pxSize + maskSize);
  buf.writeUInt32LE(40, 0);                 // biSize
  buf.writeInt32LE(w, 4);                   // biWidth
  buf.writeInt32LE(h * 2, 8);               // biHeight：像素 + mask 双高
  buf.writeUInt16LE(1, 12);                 // biPlanes
  buf.writeUInt16LE(32, 14);                // biBitCount
  buf.writeUInt32LE(pxSize + maskSize, 20); // biSizeImage
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;        // DIB 像素自底向上
    const dst = 40 + y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = src + x * 4, d = dst + x * 4;
      buf[d] = rgba[s + 2];                 // B
      buf[d + 1] = rgba[s + 1];             // G
      buf[d + 2] = rgba[s];                 // R
      buf[d + 3] = rgba[s + 3];             // A（mask 全 0 时 alpha 即生效）
    }
  }
  return buf;
}

const PLAN = [
  { file: 'build/icon.png', size: 1024, pct: 0.8, bg: 'rounded' },
  { file: 'src/assets/icon.png', size: 512, pct: 0.8, bg: 'rounded' },
  { file: 'src-tauri/icons/icon.png', size: 1024, pct: 0.8, bg: 'rounded' },
];
const DENS = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];
const FDENS = [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]];
// 自适应图标前景层：108dp 画布仅中心 66dp 安全区可见（Google 规范，最严格的圆形裁切）。
// 要求可见区内图形宽占 83%（app2-256 构图：左右各 ~8.5% 空隙）→ pct = 0.83 × 66/108 ≈ 0.51
for (const [d, s] of DENS)
  PLAN.push({ file: `release/android-icons/mipmap-${d}/ic_launcher.png`, size: s, pct: 0.8, bg: 'rounded' });
for (const [d, s] of DENS)
  PLAN.push({ file: `release/android-icons/mipmap-${d}/ic_launcher_round.png`, size: s, pct: 0.66, bg: 'circle' });
for (const [d, s] of FDENS)
  PLAN.push({ file: `release/android-icons/drawable-${d}/ic_launcher_foreground.png`, size: s, pct: 0.51, bg: 'none' });

const html = `<!doctype html><meta charset="utf-8"><canvas id="c"></canvas><script>
window.render = (jobs, raw) => Promise.all(jobs.map((j) => new Promise((res) => {
  const img = new Image();
  img.onload = () => {
    const c = document.getElementById('c');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    if (raw) {
      const rgba = Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
      res([j.file, { dataUrl: c.toDataURL('image/png'), rgba }]);
    } else {
      res([j.file, c.toDataURL('image/png')]);
    }
  };
  img.onerror = () => res([j.file, null]);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(j.svg);
}))).then((pairs) => raw
  ? Object.fromEntries(pairs.map(([f, v]) => [f, v]))
  : Object.fromEntries(pairs.map(([f, v]) => [f, v])));
</script>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const jobs = PLAN.map((p) => ({ file: p.file, svg: svgCompose(p.size, p.pct, p.bg) }));
  const results = await win.webContents.executeJavaScript(`render(${JSON.stringify(jobs)})`, true);
  let fail = 0;
  for (const [file, dataUrl] of Object.entries(results)) {
    if (!dataUrl) { console.error('[FAIL]', file); fail++; continue; }
    const dst = path.join(ROOT, file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('[icon]', file, fs.statSync(dst).size, 'bytes');
  }

  // Windows .ico：≤128 帧必须用 DIB（BITMAPINFOHEADER+BGRA）——Windows shell 小尺寸
  // 只可靠解析 BMP 帧，PNG 帧仅 256×256 规范支持（此前全 PNG 导致快捷方式图标空白）
  const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
  const icoJobs = ICO_SIZES.map((s) => ({ file: String(s), svg: svgCompose(s, 0.8, 'rounded') }));
  const icoRenders = await win.webContents.executeJavaScript(
    `render(${JSON.stringify(icoJobs)}, true)`, true,
  );
  const blobs = ICO_SIZES.map((s) => {
    const { dataUrl, rgba } = icoRenders[String(s)];
    return s <= 128 ? rgbaToDib(rgba, s, s) : Buffer.from(dataUrl.split(',')[1], 'base64');
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(ICO_SIZES.length, 4);
  let offset = 6 + 16 * ICO_SIZES.length;
  const entries = Buffer.alloc(16 * ICO_SIZES.length);
  ICO_SIZES.forEach((s, i) => {
    const e = i * 16;
    entries.writeUInt8(s >= 256 ? 0 : s, e);          // 宽（256 编码为 0）
    entries.writeUInt8(s >= 256 ? 0 : s, e + 1);      // 高
    entries.writeUInt8(0, e + 2);                     // 调色板数
    entries.writeUInt8(0, e + 3);                     // 保留
    entries.writeUInt16LE(1, e + 4);                  // planes
    entries.writeUInt16LE(32, e + 6);                 // bpp
    entries.writeUInt32LE(blobs[i].length, e + 8);    // 数据大小
    entries.writeUInt32LE(offset, e + 12);            // 数据偏移
    offset += blobs[i].length;
  });
  fs.mkdirSync(path.join(ROOT, 'src-tauri', 'icons'), { recursive: true });
  const icoBuf = Buffer.concat([header, entries, ...blobs]);
  fs.writeFileSync(path.join(ROOT, 'src-tauri', 'icons', 'icon.ico'), icoBuf);
  // electron-builder 嵌 exe 图标（rcedit）用：多尺寸 ico 直接指定，避免 png 单帧转换
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), icoBuf);
  console.log('[icon] src-tauri/icons/icon.ico + build/icon.ico', icoBuf.length, 'bytes');
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
