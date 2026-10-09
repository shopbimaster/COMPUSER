/*!
 * 品牌同步：branding.js（唯一事实源）→ package.json / build/branding.nsh
 * 由 npm 生命周期钩子 predist 自动执行；也可 node scripts/apply-branding.mjs 手动运行。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = require(join(root, 'branding.js'));

// ---- package.json：打包相关的品牌字段 ----
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = brand.APP_NAME.toLowerCase(); // 技术包名（决定安装版 %APPDATA% 目录名）
pkg.description = `${brand.FULL_NAME} - ${brand.TAGLINE}`;
pkg.build.productName = brand.APP_NAME;
pkg.build.appId = brand.APP_ID;
pkg.build.nsis.shortcutName = brand.APP_NAME;
pkg.build.nsis.artifactName = `${brand.APP_NAME}-Setup-\${version}.\${ext}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// ---- build/branding.nsh：NSIS 侧品牌宏 ----
const nsh = `; 由 scripts/apply-branding.mjs 自动生成（源：branding.js），勿手改
!define BRAND_NAME "${brand.APP_NAME}"
!define BRAND_FULL_NAME "${brand.FULL_NAME}"
!define BRAND_TAGLINE "${brand.TAGLINE}"
`;
writeFileSync(join(root, 'build', 'branding.nsh'), nsh, 'utf8');

console.log(`[apply-branding] ${brand.APP_NAME} → package.json / build/branding.nsh`);
