/*!
 * CampUser · 品牌唯一事实源（单一修改接口）
 *
 * 全部软件名/品牌文案集中在此，任何地方不得硬编码：
 *  - Electron 主进程：require('./branding')
 *  - 渲染进程：index.html 以 <script src="../branding.js"> 引入 → window.CAMPUSER_BRAND
 *  - 打包配置：npm run dist 前由 scripts/apply-branding.mjs 自动把本文件
 *    同步进 package.json（name/productName/description/appId/shortcutName/
 *    artifactName）与 build/branding.nsh（NSIS 宏），无需手动改第二处。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CAMPUSER_BRAND = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    /** 短名：窗口标题、快捷方式、进程名等（全大写，取 Campus + er 之意） */
    APP_NAME: 'CAMPUSER',
    /** 完整显示名：向用户展示的软件名（无副标题；后续校园功能统一在此品牌下） */
    FULL_NAME: 'CAMPUSER',
    /** 一句话定位（安装/关于页可复用） */
    TAGLINE: '本地 · 无广告 · 数据完全本地',
    /** 导出文件名前缀：CAMPUSER-backup-*.json / CAMPUSER-*.csv 等 */
    EXPORT_PREFIX: 'CAMPUSER',
    /** 应用 ID（安装/注册表/自启动键） */
    APP_ID: 'com.campuser.app'
  };
});
