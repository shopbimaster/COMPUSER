// campuser · application composition. Modules own UI behavior; platform I/O stays in ports.
import { $, BRAND, Ports, session, currentSchedule, currentSettings, showToast } from './ui/context.mjs';
import { calcCurrentWeek, render } from './ui/grid.mjs';
import { syncStatusBarTheme, updateThemeToggleLabel } from './ui/today.mjs';
import { bindEvents } from './ui/events.mjs';
import { persistence, persist, bindStorageUI, showStorageProblem } from './ui/storage-ui.mjs';

async function init() {
  bindStorageUI();
  document.documentElement.dataset.theme = 'light';
  if (!Ports.isElectron && !Ports.isTauri) $('modeBadge').hidden = false;
  try {
    await Ports.ready;
    const loaded = await persistence.load();
    session.state = loaded.state;
    document.documentElement.dataset.theme = session.state.prefs.theme;
    session.viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, calcCurrentWeek()));
    updateThemeToggleLabel();
    syncStatusBarTheme();
    bindEvents();
    render();
    if (loaded.recovered || loaded.migrated) {
      if (!(await persist())) return;
      showToast(loaded.recovered ? '已从自动备份恢复课表，损坏的原始数据已保留。' : '旧版课表已安全升级。', 6000);
    } else if (!currentSchedule().courses.length) {
      showToast(`欢迎使用 ${BRAND.FULL_NAME}！请先到「更多 → 课表设置」填写学期开始日期`, 5000);
    }
  } catch (error) { showStorageProblem(error, true); }
}

export const ready = init();
