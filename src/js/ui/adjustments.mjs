// campuser · adjustments
import { currentSchedule, currentSettings, touchSchedule, showToast, escapeHtml, Adj, $, session } from "./context.mjs";
import { render } from "./grid.mjs";
import { openModal, closeModal } from "./dialogs.mjs";
import { persist } from "./storage-ui.mjs";

// ---------- 拖动调课确认窗 ----------

const DAY_CN = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};

function openAdjustMoveModal(course, slot, toDay, toStart) {
  const endSec = slot.start + slot.step - 1;
  session.pendingAdjust = { course, slot, toDay, toStart };
  $("adjustMoveDetail").innerHTML =
    `<div>将「<b>${escapeHtml(course.name)}</b>」</div>` +
    `<div class="adj-time-box">从 ${DAY_CN[slot.day] || slot.day} 第 ${slot.start}-${endSec} 节（第 ${slot.startWeek}~${slot.endWeek} 周）</div>` +
    `<div class="adj-time-box">调到 ${DAY_CN[toDay] || toDay} 第 ${toStart}-${toStart + slot.step - 1} 节</div>`;
  openModal("adjustMoveModal");
}

async function applyAdjustMove(mode) {
  if (!session.pendingAdjust) return;
  const { course, slot, toDay, toStart } = session.pendingAdjust;
  const idx = course.timeSlots.indexOf(slot);
  session.pendingAdjust = null;
  closeModal("adjustMoveModal");
  if (idx < 0) return;
  // 释放回原位：不做任何数据变更（避免「只调这一节」把原段拆出冗余单周段）
  if (toDay === slot.day && toStart === slot.start) {
    showToast("位置未变化");
    return;
  }
  if (mode === "one")
    Adj.moveSlotOneWeek(course, idx, session.viewWeek, toDay, toStart, slot.step);
  else Adj.moveSlotAll(course, idx, toDay, toStart, slot.step);
  touchSchedule();
  if (!(await persist())) return;
  render();
  showToast(
    mode === "one"
      ? `已调整第 ${session.viewWeek} 周的该节课程`
      : "已调整该时间段的所有周次",
  );
}

// ---------- 整日调课 ----------

// 表头点击 → 下方弹出「整日调课」入口按钮
function openDayAdjustMenu(headerEl, day, dateIso) {
  document.querySelectorAll(".day-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "day-menu";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "整日调课";
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    menu.remove();
    openAdjustDayModal(day, dateIso);
  });
  menu.appendChild(btn);
  headerEl.appendChild(menu);
  // 水平定位全由 JS 计算并钳制屏内（CSS 不再 translateX 居中，避免与入场动画的
  // transform 关键帧互相覆盖造成弹出瞬移）；左右列同样受钳制保护。
  // 注意 style.left 相对 header 锚点：钳制后的视口坐标须减去 header 视口 left
  const mw = menu.offsetWidth;
  const hr = headerEl.getBoundingClientRect();
  let left = hr.left + hr.width / 2 - mw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menu.style.left = left - hr.left + "px";
}

// 自绘下拉（与设置页「一天课程节数」同款标准）：触发按钮 + 滚动面板 + hidden 承值
// ids = [btnId, menuId, hiddenId]
// 面板为独立图层：挂 body + fixed 定位（dd-fixed），以触发按钮为中心展开，
// 不占据弹窗文档流（否则溢出会撑大弹窗滚动高度，把内容挤出滑轨）
function initSrSelect(ids) {
  const btn = $(ids[0]);
  const menu = $(ids[1]);
  document.body.appendChild(menu);
  menu.classList.add("dd-fixed");
  btn.onclick = () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      document.querySelectorAll(".dd-fixed").forEach((m) => {
        if (m !== menu) m.hidden = true;
      });
      const cur = menu.querySelector("button.sel");
      if (cur) cur.scrollIntoView({ block: "nearest" });
      // 定位：水平以触发按钮中心对齐（钳制在屏内），默认下方展开，空间不足向上翻
      const r = btn.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      let left = r.left + r.width / 2 - mw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
      let top = r.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    }
  };
  menu.onclick = (e) => {
    const b = e.target.closest("button[data-val]");
    if (!b) return;
    setSrSelect(ids, b.dataset.val, b.textContent);
    menu.hidden = true;
  };
}

// 设值：hidden 值 + 触发按钮文字 + 面板选中态
function setSrSelect(ids, val, label) {
  $(ids[2]).value = val;
  $(ids[0]).textContent = label;
  $(ids[1])
    .querySelectorAll("button")
    .forEach((x) => x.classList.toggle("sel", x.dataset.val === String(val)));
}

function openAdjustDayModal(day, dateIso) {
  const s = currentSettings();
  session.adjustDayFrom = dateIso;
  const dateIds = [
    ["adjFromDateBtn", "adjFromDateMenu", "adjFromDate"],
    ["adjToDateBtn", "adjToDateMenu", "adjToDate"],
  ];
  const weekIds = [
    ["adjFromWeekBtn", "adjFromWeekMenu", "adjFromWeek"],
    ["adjToWeekBtn", "adjToWeekMenu", "adjToWeek"],
  ];
  const dayIds = [
    ["adjFromDayBtn", "adjFromDayMenu", "adjFromDay"],
    ["adjToDayBtn", "adjToDayMenu", "adjToDay"],
  ];
  // 日期面板：按周分组（第N周组头 + 7 天选项），面板限高滚动（dd-sm 246px）
  const fillDates = (ids) => {
    let html = "";
    for (let w = 1; w <= s.totalWeeks; w++) {
      html += `<div class="dd-group">第${w}周</div>`;
      for (let d = 1; d <= 7; d++) {
        const iso = Adj.dateOfWeekDay(s.termStart, w, d);
        html += `<button type="button" data-val="${iso}" class="${
          iso === dateIso ? "sel" : ""
        }">${iso.slice(5)} ${DAY_CN[d]}</button>`;
      }
    }
    $(ids[1]).innerHTML = html;
  };
  const menuLabel = (menuId, val) => {
    const b = $(menuId).querySelector(`button[data-val="${val}"]`);
    return b ? b.textContent : val;
  };
  for (const ids of dateIds) {
    initSrSelect(ids);
    fillDates(ids);
  }
  for (const ids of weekIds) {
    initSrSelect(ids);
    $(ids[1]).innerHTML = Array.from(
      { length: s.totalWeeks },
      (_, i) =>
        `<button type="button" data-val="${i + 1}">第${i + 1}周</button>`,
    ).join("");
  }
  for (const ids of dayIds) {
    initSrSelect(ids);
    $(ids[1]).innerHTML = [1, 2, 3, 4, 5, 6, 7]
      .map((d) => `<button type="button" data-val="${d}">${DAY_CN[d]}</button>`)
      .join("");
  }
  // 模式复位为按日期；起点预选点击的日期，目标默认同日；周次/星期模式默认换算到点击日期
  document.querySelector('input[name="adjMode"][value="date"]').checked = true;
  document.querySelector('input[name="adjMode"][value="week"]').checked = false;
  setSrSelect(dateIds[0], dateIso, menuLabel("adjFromDateMenu", dateIso));
  setSrSelect(dateIds[1], dateIso, menuLabel("adjToDateMenu", dateIso));
  const cur = Adj.weekDayOfDate(s.termStart, dateIso, s.totalWeeks);
  const cw = cur ? cur.w : 1;
  const cd = cur ? cur.d : day;
  setSrSelect(weekIds[0], cw, `第${cw}周`);
  setSrSelect(dayIds[0], cd, DAY_CN[cd]);
  setSrSelect(weekIds[1], cw, `第${cw}周`);
  setSrSelect(dayIds[1], cd, DAY_CN[cd]);
  const syncVis = () => {
    const byDate =
      document.querySelector('input[name="adjMode"]:checked').value === "date";
    // 切模式收起独立图层面板（隐藏的宿主 wrap 管不到挂 body 的面板）
    document.querySelectorAll(".dd-fixed").forEach((m) => (m.hidden = true));
    for (const id of ["adjFromDateWrap", "adjToDateWrap"])
      $(id).hidden = !byDate;
    for (const id of [
      "adjFromWeekWrap",
      "adjFromDayWrap",
      "adjToWeekWrap",
      "adjToDayWrap",
    ])
      $(id).hidden = byDate;
  };
  syncVis();
  for (const r of document.querySelectorAll('input[name="adjMode"]'))
    r.onchange = syncVis;
  openModal("adjustDayModal");
}

async function confirmAdjustDay() {
  const s = currentSettings();
  const byDate =
    document.querySelector('input[name="adjMode"]:checked').value === "date";
  let fromW, fromD, toW, toD;
  if (byDate) {
    const f = Adj.weekDayOfDate(
      s.termStart,
      $("adjFromDate").value,
      s.totalWeeks,
    );
    const t = Adj.weekDayOfDate(
      s.termStart,
      $("adjToDate").value,
      s.totalWeeks,
    );
    if (!f || !t) {
      showToast("所选日期超出课表范围");
      return;
    }
    ({ w: fromW, d: fromD } = f);
    ({ w: toW, d: toD } = t);
  } else {
    fromW = Number($("adjFromWeek").value);
    fromD = Number($("adjFromDay").value);
    toW = Number($("adjToWeek").value);
    toD = Number($("adjToDay").value);
  }
  if (fromW === toW && fromD === toD) {
    showToast("调课起点与目标相同");
    return;
  }
  const courses = currentSchedule().courses;
  const r = Adj.adjustWholeDay(courses, fromW, fromD, toW, toD);
  if (!r.moved) {
    showToast("起点当天没有课程，无需调整");
    return;
  }
  closeModal("adjustDayModal");
  touchSchedule();
  if (!(await persist())) return;
  render();
  const fromTxt = byDate
    ? $("adjFromDate").value.slice(5)
    : `第${fromW}周${DAY_CN[fromD]}`;
  const toTxt = byDate
    ? $("adjToDate").value.slice(5)
    : `第${toW}周${DAY_CN[toD]}`;
  showToast(
    `已将 ${fromTxt} 的 ${r.moved} 节课（${r.courses} 门）调整到 ${toTxt}`,
    4000,
  );
}

export { openAdjustMoveModal, applyAdjustMove, openDayAdjustMenu, initSrSelect, setSrSelect, openAdjustDayModal, confirmAdjustDay, DAY_CN };
