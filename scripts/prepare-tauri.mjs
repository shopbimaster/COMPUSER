// 组装 Tauri frontendDist：index.html 位于 src/，引用 ../core 与 ../adapters，
// 因此按 app/ + core/ + adapters/ 的布局拼装到 dist/，tauri.conf.json 的窗口入口指向 app/index.html。
import { cpSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';

const dist = 'dist';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync('src', `${dist}/app`, { recursive: true });
cpSync('core', `${dist}/core`, { recursive: true });
cpSync('adapters', `${dist}/adapters`, { recursive: true });
copyFileSync('branding.js', `${dist}/branding.js`); // index.html 引用 ../branding.js
console.log('[prepare-tauri] dist/ assembled');
