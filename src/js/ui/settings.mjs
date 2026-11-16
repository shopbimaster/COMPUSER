// campuser · settings
import { currentSchedule, currentSettings, touchSchedule, showToast, M, $, session, addMinutes } from "./context.mjs";
import { calcCurrentWeek, render, updateWeekUI } from "./grid.mjs";
import { openModal, closeModal } from "./dialogs.mjs";
import { persist } from "./storage-ui.mjs";

// ---------- 设置（挂当前课表） ----------
function openSettings() {
  const s = currentSettings();
  $("s_scheduleName").value = currentSchedule().name;
  $("s_termStart").value = s.termStart;
  $("s_totalWeeks").value = s.totalWeeks;
  // 一天课程节数：自绘下拉（原生 select 展开浮层是系统渲染，无法与整体风格统一）
  const cnVal = $("s_classNum");
  cnVal.value = s.classNum;
  const cnBtn = $("s_classNumBtn");
  cnBtn.textContent = s.classNum + " 节";
  const cnMenu = $("s_classNumMenu");
  cnMenu.innerHTML = [8, 9, 10, 11, 12, 13, 14, 15, 16]
    .map(
      (i) =>
        `<button type="button" data-cn="${i}" class="${i === s.classNum ? "sel" : ""}">${i} 节</button>`,
    )
    .join("");
  cnBtn.onclick = () => {
    cnMenu.hidden = !cnMenu.hidden;
  };
  cnMenu.onclick = (e) => {
    const b = e.target.closest("button[data-cn]");
    if (!b) return;
    cnVal.value = b.dataset.cn;
    cnBtn.textContent = b.dataset.cn + " 节";
    cnMenu
      .querySelectorAll("button")
      .forEach((x) => x.classList.toggle("sel", x === b));
    cnMenu.hidden = true;
    buildTimeTable(Number(b.dataset.cn)); // 节数变化即时同步时间表（保留已填值）
  };
  // 开机自启设置项已移除（安装向导承担）；保留端口供未来扩展
  $("s_alpha").value = s.alpha;
  $("alphaVal").textContent = s.alpha + "%";
  $("s_saturation").value = s.saturation;
  $("satVal").textContent = s.saturation + "%";
  $("s_itemHeight").value = s.itemHeight;
  $("heightVal").textContent = s.itemHeight + "px";
  $("s_showColBg").checked = s.showColBg;
  $("rowColBgDark").hidden = !s.showColBg;
  $("rowColBgAlpha").hidden = !s.showColBg;
  $("s_colBgAlpha").value = s.colBgAlpha;
  $("colBgAlphaVal").textContent = s.colBgAlpha + "%";
  // 衬底深浅自绘下拉（light=浅色比背景浅 / dark=深色比背景深）
  const bgdNames = { light: "浅色", dark: "深色" };
  const cbBtn = $("s_colBgDarkBtn");
  const cbMenu = $("s_colBgDarkMenu");
  const cbHidden = $("s_colBgDark");
  cbHidden.value = s.colBgDark ? "dark" : "light";
  cbBtn.textContent = bgdNames[cbHidden.value] || "浅色";
  cbMenu.innerHTML = ["light", "dark"]
    .map(
      (v) =>
        `<button type="button" data-bgd="${v}" class="${v === cbHidden.value ? "sel" : ""}">${bgdNames[v]}</button>`,
    )
    .join("");
  cbBtn.onclick = () => {
    cbMenu.hidden = !cbMenu.hidden;
  };
  cbMenu.onclick = (e) => {
    const b = e.target.closest("button[data-bgd]");
    if (!b) return;
    cbHidden.value = b.dataset.bgd;
    cbBtn.textContent = bgdNames[b.dataset.bgd] || "浅色";
    cbMenu.hidden = true;
    cbMenu
      .querySelectorAll("button[data-bgd]")
      .forEach((x) => x.classList.toggle("sel", x === b));
  };
  $("s_showOtherWeek").checked = s.showOtherWeek;
  $("s_showSchName").checked = s.showSchName;
  $("s_showWeekTitle").checked = s.showWeekTitle;
  $("rowOtherWeekAlpha").hidden = !s.showOtherWeek;
  $("s_owAlpha").value = s.otherWeekAlpha;
  $("owAlphaVal").textContent = s.otherWeekAlpha + "%";
  $("s_headerFs").value = s.headerTextSize;
  $("headerFsVal").textContent = s.headerTextSize + "px";
  $("s_showSaturday").checked = s.showSaturday;
  $("s_showSunday").checked = s.showSunday;
  $("rowSundayFirst").hidden = !s.showSunday;
  $("s_sundayFirst").checked = s.sundayFirst;
  $("s_textFs").value = s.courseTextSize;
  $("textFsVal").textContent = s.courseTextSize + "px";
  // 格子文字颜色自绘下拉（auto=按格子色亮度 / black / white）
  const colorNames = { auto: "自动", black: "黑色", white: "白色" };
  const tcBtn = $("s_textColorBtn");
  const tcMenu = $("s_textColorMenu");
  const tcHidden = $("s_textColor");
  tcHidden.value = s.courseTextColor || "auto";
  tcBtn.textContent = colorNames[tcHidden.value] || "自动";
  tcMenu.innerHTML = ["auto", "black", "white"]
    .map(
      (v) =>
        `<button type="button" data-tc="${v}" class="${v === tcHidden.value ? "sel" : ""}">${colorNames[v]}</button>`,
    )
    .join("");
  tcBtn.onclick = () => {
    tcMenu.hidden = !tcMenu.hidden;
  };
  tcMenu.onclick = (e) => {
    const b = e.target.closest("button[data-tc]");
    if (!b) return;
    tcHidden.value = b.dataset.tc;
    tcBtn.textContent = colorNames[b.dataset.tc] || "自动";
    tcMenu.hidden = true;
    tcMenu
      .querySelectorAll("button[data-tc]")
      .forEach((x) => x.classList.toggle("sel", x === b));
  };
  $("s_radius").value = s.cornerRadius;
  $("radiusVal").textContent = s.cornerRadius + "px";
  $("s_courseGap").value = s.courseGap;
  $("courseGapVal").textContent = s.courseGap + "%";
  $("s_textHCenter").checked = s.textHCenter;
  $("s_textVCenter").checked = s.textVCenter;
  $("s_showTimeInGrid").checked = s.showTimeInGrid;
  $("s_showTeachInGrid").checked = s.showTeachInGrid;
  // 预留接口：s_showNoteInGrid 已挂 UI，渲染逻辑后续版本接入（网格辅助线项已移除）
  $("s_showNoteInGrid").checked = s.showNoteInGrid;
  $("s_sameLen").checked = s.sameLen;
  $("s_lessonLen").disabled = !s.sameLen;
  $("btnApplyLen").disabled = !s.sameLen;
  const [sh, sm] = s.times[0].start.split(":").map(Number);
  const [eh, em] = s.times[0].end.split(":").map(Number);
  $("s_lessonLen").value = eh * 60 + em - (sh * 60 + sm);
  $("timeTable").innerHTML = ""; // 清空上一次会话残留（未保存的修改随取消丢弃）
  buildTimeTable();
  openModal("settingsModal");
}

function buildTimeTable(count) {
  const s = currentSettings();
  const n = Number(count) || s.classNum;
  const box = $("timeTable");
  // 保留当前已填/已同步的时间（改节数、切换等长时不回退），去留在保存/取消时确定
  const prev = {};
  box.querySelectorAll("input[data-ti]").forEach((inp) => {
    prev[inp.dataset.ti + ":" + inp.dataset.field] = inp.value;
  });
  box.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const t = s.times[i] || { start: "08:00", end: "08:45" };
    const start = i + ":start" in prev ? prev[i + ":start"] : t.start;
    const end = i + ":end" in prev ? prev[i + ":end"] : t.end;
    const row = document.createElement("div");
    row.className = "time-row";
    row.innerHTML = `
      <span class="t-no">${i + 1}</span>
      <input type="time" value="${start}" data-ti="${i}" data-field="start">
      <span class="t-sep">~</span>
      <input type="time" value="${end}" data-ti="${i}" data-field="end" ${s.sameLen ? "disabled" : ""}>
    `;
    box.appendChild(row);
  }
}

function collectSettings() {
  const cur = currentSettings();
  const s = { ...cur };
  s.termStart = $("s_termStart").value || cur.termStart;
  s.totalWeeks = Number($("s_totalWeeks").value) || 20;
  s.classNum = Number($("s_classNum").value);
  s.alpha = Number($("s_alpha").value);
  s.saturation = Number($("s_saturation").value);
  s.itemHeight = Number($("s_itemHeight").value);
  s.showColBg = $("s_showColBg").checked;
  s.colBgAlpha = Number($("s_colBgAlpha").value);
  s.colBgDark = $("s_colBgDark").value === "dark";
  s.showOtherWeek = $("s_showOtherWeek").checked;
  s.showSchName = $("s_showSchName").checked;
  s.showWeekTitle = $("s_showWeekTitle").checked;
  s.otherWeekAlpha = Number($("s_owAlpha").value);
  s.headerTextSize = Number($("s_headerFs").value);
  s.showSaturday = $("s_showSaturday").checked;
  s.showSunday = $("s_showSunday").checked;
  s.sundayFirst = $("s_sundayFirst").checked;
  s.courseTextSize = Number($("s_textFs").value);
  s.courseTextColor = $("s_textColor").value || "auto";
  s.cornerRadius = Number($("s_radius").value);
  s.courseGap = Number($("s_courseGap").value);
  s.textHCenter = $("s_textHCenter").checked;
  s.textVCenter = $("s_textVCenter").checked;
  s.showTimeInGrid = $("s_showTimeInGrid").checked;
  s.showTeachInGrid = $("s_showTeachInGrid").checked;
  s.showNoteInGrid = $("s_showNoteInGrid").checked;
  s.sameLen = $("s_sameLen").checked;
  s.times = cur.times.map((t) => ({ ...t }));
  document.querySelectorAll("#timeTable input[data-ti]").forEach((inp) => {
    const i = Number(inp.dataset.ti);
    // 增加节数后时间表行数可能多于当前 times，补默认项防止越界（否则保存会抛错无响应）
    if (!s.times[i]) s.times[i] = { start: "08:00", end: "08:45" };
    if (inp.value) s.times[i][inp.dataset.field] = inp.value;
  });
  if (s.sameLen) {
    const len = Number($("s_lessonLen").value) || 45;
    s.times.forEach((t) => {
      t.end = addMinutes(t.start, len);
    });
  }
  return s;
}

async function saveSettings() {
  const sch = currentSchedule();
  const oldTermStart = sch.settings.termStart;
  const raw = collectSettings();
  // 上课时间顺序检查：下课不得早于上课（相等允许——上调上课时间时已自动对齐下课）；
  // 下节课开始不得早于上节课结束
  for (let i = 0; i < raw.classNum; i++) {
    const t = raw.times[i];
    if (t.end < t.start) {
      showToast(`第 ${i + 1} 节的下课时间不能早于上课时间`);
      return;
    }
    if (i > 0 && t.start < raw.times[i - 1].end) {
      showToast(`第 ${i + 1} 节的上课时间不能早于第 ${i} 节的下课时间`);
      return;
    }
  }
  sch.name = $("s_scheduleName").value.trim() || sch.name;
  sch.settings = M.normalizeSettings(raw);

  session.viewWeek = Math.min(sch.settings.totalWeeks, Math.max(1, session.viewWeek));
  if (oldTermStart !== sch.settings.termStart) {
    session.viewWeek = Math.min(
      sch.settings.totalWeeks,
      Math.max(1, calcCurrentWeek()),
    );
  }
  touchSchedule();
  if (!(await persist())) return;
  updateWeekUI();
  render();
  closeModal("settingsModal");
  showToast("设置已保存");
}

export { openSettings, buildTimeTable, collectSettings, saveSettings };
