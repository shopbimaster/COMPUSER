// campuser · dialogs
import { $ } from "./context.mjs";

// ---------- 弹窗开关 ----------
function openModal(id) {
  const m = $(id);
  m.hidden = false;
  // 每次打开都回到顶部：上次滚动位置不带入下一次（含所有内层滚动容器）
  m.scrollTop = 0;
  m.querySelectorAll("*").forEach((el) => {
    if (el.scrollTop > 0) el.scrollTop = 0;
  });
}
function closeModal(id) {
  $(id).hidden = true;
  // 独立图层的自绘下拉面板（挂 body）随宿主弹窗一并收起
  document.querySelectorAll(".dd-fixed").forEach((m) => (m.hidden = true));
}

export { openModal, closeModal };
