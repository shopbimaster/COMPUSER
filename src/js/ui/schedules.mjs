// campuser · schedules
import { currentSchedule, currentSettings, showToast, escapeHtml, M, $, session } from "./context.mjs";
import { calcCurrentWeek, render, updateWeekUI } from "./grid.mjs";
import { openModal, closeModal } from "./dialogs.mjs";
import { persist } from "./storage-ui.mjs";

// ---------- 课表管理（多课表） ----------
async function switchSchedule(id) {
  if (!session.state.schedules.find((s) => s.id === id)) return;
  session.state.currentScheduleId = id;
  session.state.updatedAt = Date.now();
  if (!(await persist())) return;
  session.viewWeek = Math.min(
    currentSettings().totalWeeks,
    Math.max(1, calcCurrentWeek()),
  );
  updateWeekUI();
  render();
  showToast(`已切换到「${currentSchedule().name}」`);
}

function openScheduleManager() {
  renderScheduleList();
  openModal("scheduleModal");
}

function renderScheduleList() {
  const box = $("scheduleList");
  box.innerHTML = "";
  session.state.schedules.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "sch-row";
    row.dataset.id = s.id;
    row.innerHTML = `
      <button type="button" class="icon-btn sch-up" title="上移" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="icon-btn sch-down" title="下移" ${i === session.state.schedules.length - 1 ? "disabled" : ""}>↓</button>
      <input type="text" class="sch-name" value="${escapeHtml(s.name)}" maxlength="30">
      <span class="sch-meta">${s.courses.length} 门课${s.id === session.state.currentScheduleId ? " · 当前" : ""}</span>
      <button type="button" class="danger-btn sch-del">删除</button>
    `;
    box.appendChild(row);
  });
}

function bindScheduleManager() {
  $("btnNewSch").onclick = () => {
    closeModal("weekPanel");
    openModal("scheduleModal");
    $("newScheduleName").focus();
  };
  $("btnManageSch").onclick = () => {
    closeModal("weekPanel");
    openScheduleManager();
  };
  $("btnCreateSchedule").onclick = async () => {
    const name = $("newScheduleName").value.trim();
    if (!name) {
      showToast("请输入新课表名称");
      return;
    }
    const sch = M.normalizeSchedule({ name });
    session.state.schedules.push(sch);
    session.state.currentScheduleId = sch.id;
    session.state.updatedAt = Date.now();
    $("newScheduleName").value = "";
    if (!(await persist())) return;
    updateWeekUI();
    renderScheduleList();
    render();
    showToast(`已创建「${sch.name}」`);
  };

  const box = $("scheduleList");
  box.addEventListener("click", async (e) => {
    const row = e.target.closest(".sch-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".sch-up") || e.target.closest(".sch-down")) {
      const idx = session.state.schedules.findIndex((s) => s.id === id);
      const dir = e.target.closest(".sch-up") ? -1 : 1;
      const j = idx + dir;
      if (j < 0 || j >= session.state.schedules.length) return;
      [session.state.schedules[idx], session.state.schedules[j]] = [
        session.state.schedules[j],
        session.state.schedules[idx],
      ];
      session.state.updatedAt = Date.now();
      if (!(await persist())) return;
      updateWeekUI();
      renderScheduleList();
      return;
    }
    if (e.target.closest(".sch-del")) {
      if (session.state.schedules.length <= 1) {
        showToast("至少保留一个课表");
        return;
      }
      const btn = e.target.closest(".sch-del");
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.classList.add("armed");
        btn.textContent = "确认删除?";
        setTimeout(() => {
          btn.dataset.armed = "";
          btn.classList.remove("armed");
          btn.textContent = "删除";
        }, 3000);
        return;
      }
      session.state.schedules = session.state.schedules.filter((s) => s.id !== id);
      if (session.state.currentScheduleId === id)
        session.state.currentScheduleId = session.state.schedules[0].id;
      session.state.updatedAt = Date.now();
      if (!(await persist())) return;
      updateWeekUI();
      renderScheduleList();
      render();
      showToast("课表已删除");
    }
  });
  box.addEventListener("change", async (e) => {
    if (!e.target.classList.contains("sch-name")) return;
    const row = e.target.closest(".sch-row");
    const s = session.state.schedules.find((x) => x.id === row.dataset.id);
    if (!s) return;
    s.name = e.target.value.trim() || s.name;
    s.updatedAt = Date.now();
    session.state.updatedAt = Date.now();
    if (!(await persist())) return;
    updateWeekUI();
    row.querySelector(".sch-meta").textContent =
      `${s.courses.length} 门课${s.id === session.state.currentScheduleId ? " · 当前" : ""}`;
  });
}

export { switchSchedule, openScheduleManager, renderScheduleList, bindScheduleManager };
