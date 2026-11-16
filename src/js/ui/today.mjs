// campuser · today
import { currentSettings, escapeHtml, DAY_NAMES, Ports, $, session, C, toMin } from "./context.mjs";
import { allEntries, calcCurrentWeek, render, entryStartMin } from "./grid.mjs";
import { openModal } from "./dialogs.mjs";
import { persist } from "./storage-ui.mjs";

// ---------- 今日课程 ----------
// 移动端（Tauri Android）：状态栏图标随应用主题切换（浅色页面深图标 / 深色页面白图标）
function syncStatusBarTheme() {
  Ports.statusBar?.setLightIcons(session.state.prefs.theme !== "dark");
}

async function toggleTheme() {
  session.state.prefs.theme = session.state.prefs.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = session.state.prefs.theme;
  updateThemeToggleLabel();
  syncStatusBarTheme();
  if (!(await persist())) return;
  render();
}

const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>',
};

function updateThemeToggleLabel() {
  const dark = session.state.prefs.theme === "dark";
  $("pfThemeIco").innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
  $("pfThemeTxt").textContent = dark ? "日间模式" : "夜间模式";
}

function openTodayModal() {
  const now = new Date();
  const todayDay = now.getDay() === 0 ? 7 : now.getDay();
  const curWeek = calcCurrentWeek();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  $("todayModalTitle").textContent =
    `今日课程 · ${now.getMonth() + 1}月${now.getDate()}日 ${DAY_NAMES[todayDay]}`;

  const list = allEntries()
    .filter((e) => e.slot.day === todayDay && C.slotInWeek(e.slot, curWeek))
    .sort((a, b) => entryStartMin(a) - entryStartMin(b));

  const box = $("todayList");
  if (!list.length) {
    box.innerHTML = `<div class="today-empty">今天没有课，好好休息吧 ~</div>`;
  } else {
    box.innerHTML = "";
    for (const e of list) {
      const { course: c, slot: sl } = e;
      const s = currentSettings();
      let t1s, t2e;
      if (sl.customTime) {
        t1s = sl.customTime.start;
        t2e = sl.customTime.end;
      } else {
        const t1 = s.times[Math.min(sl.start, s.classNum) - 1] || {
          start: "--:--",
        };
        const t2 = s.times[
          Math.min(sl.start + sl.step - 1, s.classNum) - 1
        ] || { end: "--:--" };
        t1s = t1.start;
        t2e = t2.end;
      }
      const isPast = nowMin > toMin(t2e);
      const isNow = nowMin >= toMin(t1s) && nowMin <= toMin(t2e);
      const item = document.createElement("div");
      item.className = `today-item${isPast ? " past" : ""}${isNow ? " current" : ""}`;
      item.innerHTML = `
        <span class="t-time">${t1s}<br>${t2e}</span>
        <div>
          <div class="t-name">${escapeHtml(c.name)}</div>
          <div class="t-sub">${escapeHtml([sl.room, sl.teach && sl.teach + " 老师"].filter(Boolean).join(" · ") || "—")}</div>
        </div>
        <span class="t-session.state${isNow ? " now" : ""}">${isNow ? "● 进行中" : isPast ? "已结束" : "未开始"}</span>
      `;
      box.appendChild(item);
    }
  }
  openModal("todayModal");
}

export { syncStatusBarTheme, toggleTheme, updateThemeToggleLabel, openTodayModal, THEME_ICONS };
