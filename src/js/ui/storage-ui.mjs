// campuser · save lifecycle and recoverable errors. Draft state stays in memory on failure.
import { $, BRAND, Ports, session, showToast } from './context.mjs';
import { render, updateWeekUI } from './grid.mjs';

const persistence = window.CampuserPersistence.createPersistence(Ports.storage);
let busy = false;
const disabled = new Set();

function lockUI(lock) {
  if (lock) {
    for (const el of document.body.children) {
      if (el.id === 'storageStatus' || el.tagName === 'SCRIPT' || el.inert) continue;
      el.inert = true;
      disabled.add(el);
    }
  } else {
    for (const el of disabled) el.inert = false;
    disabled.clear();
  }
}

function showStorageProblem(error, loading = false) {
  lockUI(true);
  $('storageStatus').hidden = false;
  $('storageStatus').setAttribute('role', 'alert');
  $('storageMessage').textContent = (loading
    ? '无法打开课表，原始数据未被覆盖。'
    : '保存失败，修改仍保留在当前窗口。请重试或先导出备份。') + ' ' + (error?.message || String(error));
  $('storageRetry').hidden = loading;
  $('storageRetry').disabled = false;
  $('storageExport').hidden = !session.state;
  $('storageReload').hidden = false;
}

async function persist() {
  if (busy) return false;
  busy = true;
  lockUI(true);
  $('storageStatus').hidden = false;
  $('storageStatus').setAttribute('role', 'status');
  $('storageMessage').textContent = '正在保存…';
  for (const id of ['storageRetry', 'storageExport', 'storageReload']) $(id).hidden = true;
  try {
    await persistence.save(session.state);
    $('storageStatus').hidden = true;
    lockUI(false);
    return true;
  } catch (error) {
    showStorageProblem(error);
    return false;
  } finally { busy = false; }
}

function bindStorageUI() {
  $('storageRetry').onclick = async () => {
    if (!(await persist())) return;
    // The failed operation already changed the draft. Do not run it a second time.
    document.querySelectorAll('.modal-overlay, .dropdown').forEach(el => { el.hidden = true; });
    document.documentElement.dataset.theme = session.state.prefs.theme;
    updateWeekUI();
    render();
    showToast('修改已保存');
  };
  $('storageExport').onclick = async () => {
    try {
      const result = await Ports.share.send(JSON.stringify(session.state, null, 2), `${BRAND.EXPORT_PREFIX}-unsaved-backup.json`);
      if (result) $('storageMessage').textContent = '备份已导出；本地修改仍未保存，可继续重试。';
    } catch (error) { showStorageProblem(error); }
  };
  $('storageReload').onclick = () => {
    if (!session.state || confirm('重新加载会放弃当前窗口尚未保存的修改。建议先导出备份。是否继续？')) {
      // Acknowledge discard for this explicit reload only.
      window.removeEventListener('beforeunload', beforeUnload);
      location.reload();
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
}

function beforeUnload(event) {
  if (persistence.unsettled) { event.preventDefault(); event.returnValue = ''; }
}

export { persistence, persist, bindStorageUI, showStorageProblem };
