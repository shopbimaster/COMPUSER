// campuser · course-editor
import { currentSchedule, currentSettings, findCourse, touchSchedule, showToast, escapeHtml, COURSE_COLORS, DAY_NAMES, ODD_NAMES, svgIco, ICONS, M, $, session, W, C } from "./context.mjs";
import { courseHex, hexToHsv, hsvToHex, RANDOM_COLORS } from "./colors.mjs";
import { allEntries, render } from "./grid.mjs";
import { openModal, closeModal } from "./dialogs.mjs";
import { persist } from "./storage-ui.mjs";

// ---------- 课程弹窗（详情 / 编辑 / 添加） ----------
function openCourseModal(mode, course, slot, preset = {}) {
  session.courseModalMode = mode;
  session.editingCourseId = course ? course.id : null;
  session.editingSlotId = slot ? slot.id : null;

  $("courseModalTitle").textContent =
    mode === "add" ? "添加课程" : mode === "edit" ? "修改课程" : "课程详情";
  const isView = mode === "view";
  $("btnEditCourse").textContent = isView
    ? "编辑"
    : mode === "add"
      ? "添加"
      : "保存";
  $("btnEditCourse").classList.toggle("primary", !isView);
  $("btnEditCourse").classList.toggle("big", isView);
  $("btnDeleteCourse").hidden = mode === "add";
  $("btnCancelCourse").hidden = isView;
  $("formTip").textContent = "";

  const c =
    course ||
    M.normalizeCourse({
      name: "",
      timeSlots: [
        {
          day: preset.day || 1,
          start: preset.start || 1,
          step: preset.step || 1,
          startWeek: 1,
          endWeek: currentSettings().totalWeeks,
        },
      ],
    });

  if (mode === "view") {
    $("courseDetail").hidden = false;
    $("courseForm").hidden = true;
    renderCourseDetail(c, slot);
  } else {
    $("courseDetail").hidden = true;
    $("courseForm").hidden = false;
    fillCourseForm(c);
  }
  openModal("courseModal");
}

function slotTimeText(sl) {
  const s = currentSettings();
  if (sl.customTime) return `${sl.customTime.start} ~ ${sl.customTime.end}`;
  const t1 = s.times[Math.min(sl.start, s.classNum) - 1] || { start: "--:--" };
  const t2 = s.times[Math.min(sl.start + sl.step - 1, s.classNum) - 1] || {
    end: "--:--",
  };
  return `${t1.start} ~ ${t2.end}`;
}

function renderCourseDetail(c, slot) {
  const color = courseHex(c);
  // 点击的是 session.viewWeek 的这一节：冲突只统计本周内真正撞车的对
  const conflicts = C.conflictsOf(
    allEntries(),
    c.id,
    slot ? slot.id : null,
  ).filter(
    (p) => C.slotInWeek(p.a.slot, session.viewWeek) && C.slotInWeek(p.b.slot, session.viewWeek),
  );

  // 点击具体课程块 = 选中「这一周的这一节」，详情只展示本节实例信息
  const sl = slot || c.timeSlots[0];
  const slotBlocks = [
    `
    <div class="dt-slot-block">
      <div class="dt-row"><span class="dt-ico">${ICONS.calendar}</span><span class="dt-txt">第${session.viewWeek}周<div class="dt-sub">上课周次：${M.weeksLabel(sl.weeks) || `第${sl.startWeek} - ${sl.endWeek}周`}${sl.isOdd ? " · " + ODD_NAMES[sl.isOdd] : ""}</div></span></div>
      <div class="dt-row"><span class="dt-ico">${ICONS.clock}</span><span class="dt-txt">${DAY_NAMES[sl.day]} 第${sl.start} - ${sl.start + sl.step - 1}节<div class="dt-sub">${slotTimeText(sl).replace(" ~ ", " - ")}</div></span></div>
      ${sl.room ? `<div class="dt-row"><span class="dt-ico">${ICONS.room}</span><span class="dt-txt">${escapeHtml(sl.room)}</span></div>` : ""}
      ${sl.teach ? `<div class="dt-row"><span class="dt-ico">${ICONS.teacher}</span><span class="dt-txt">${escapeHtml(sl.teach)}</span></div>` : ""}
    </div>`,
  ].join("");

  const conflictHtml = conflicts.length
    ? `
    <div class="conflict-list">
      <div class="conflict-title">${svgIco('<path d="M12 4L2.8 19.5h18.4L12 4z"/><path d="M12 10v4.2M12 17.2v.1"/>', 14)} 存在 ${conflicts.length} 处时间冲突</div>
      ${conflicts
        .map((p) => {
          const o = p.a.course.id === c.id ? p.b.course : p.a.course;
          const os = p.a.course.id === c.id ? p.b.slot : p.a.slot;
          return `<div class="conflict-item">与《${escapeHtml(o.name)}》${DAY_NAMES[os.day]} 第${os.start}~${os.start + os.step - 1}节 重叠</div>`;
        })
        .join("")}
    </div>`
    : "";

  $("courseDetail").innerHTML = `
    <div class="dt-name">
      <span class="dt-bar" style="background:${color}"></span>
      <span class="dt-title">${escapeHtml(c.name)}</span>
      ${c.credit ? `<span class="dt-credit">${c.credit} 学分</span>` : ""}
    </div>
    ${slotBlocks}
    ${c.note ? `<div class="dt-row"><span class="dt-ico">${ICONS.note}</span><span class="dt-txt dt-note">${escapeHtml(c.note)}</span></div>` : ""}
    ${conflictHtml}
  `;
}

function fillCourseForm(c) {
  $("f_name").value = c.name;
  $("f_credit").value =
    c.credit === null || c.credit === undefined ? "" : c.credit;
  $("f_note").value = c.note || "";
  session.pickedColor =
    typeof c.color === "number"
      ? c.color
      : typeof c.color === "string" && /^#[0-9a-f]{6}$/.test(c.color)
        ? c.color
        : -1;
  $("customColorRow").hidden = true;
  updateColorUI();
  renderSlotCards(c.timeSlots);
}

// 「点击修改颜色」行：按钮颜色 + 预览块 + hex 输入，三者实时反映当前生效颜色
function pickedHex() {
  if (typeof session.pickedColor === "string") return session.pickedColor;
  if (typeof session.pickedColor === "number" && session.pickedColor >= 0)
    return COURSE_COLORS[session.pickedColor];
  const name = $("f_name").value.trim();
  const code = name ? name.charCodeAt(0) : NaN;
  return isNaN(code)
    ? RANDOM_COLORS[0]
    : RANDOM_COLORS[code % RANDOM_COLORS.length];
}

function updateColorUI() {
  const hex = pickedHex();
  $("btnToggleColor").style.color = hex;
  $("ccPreview").style.background = hex;
  if (document.activeElement !== $("ccHex"))
    $("ccHex").value = hex.slice(1).toUpperCase();
}

// 色板已移除：课名自动随机配色后，「点击修改颜色」直接进 SV 取色器

// ---------- 自定义取色器（SV 方块 + 色相条，拖动实时应用） ----------
const cpCtx = { h: 30, s: 1, v: 1, editing: false, prev: null };

function openCustomPicker(hex) {
  const { h, s, v } = hexToHsv(hex);
  Object.assign(cpCtx, { h, s, v, prev: session.pickedColor });
  $("customColorRow").hidden = false;
  renderCustomPicker();
}

function renderCustomPicker() {
  const { h, s, v } = cpCtx;
  $("cpSv").style.background =
    `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
  $("cpDot").style.left = s * 100 + "%";
  $("cpDot").style.top = (1 - v) * 100 + "%";
  $("cpDot").style.background = hsvToHex(h, s, v);
  $("cpHueDot").style.left = (h / 360) * 100 + "%";
  $("cpHueDot").style.background = `hsl(${h}, 100%, 50%)`;
}

// 拖动/hue 改变 → 实时写回 session.pickedColor 并刷新按钮与预览
function applyPickerColor() {
  session.pickedColor = hsvToHex(cpCtx.h, cpCtx.s, cpCtx.v);
  updateColorUI();
}

function bindPickerDrag(el, onmove) {
  const apply = (e) => {
    const r = el.getBoundingClientRect();
    onmove(
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    );
  };
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    cpCtx.editing = true;
    apply(e);
  });
  el.addEventListener("pointermove", (e) => {
    if (cpCtx.editing) apply(e);
  });
  el.addEventListener("pointerup", () => {
    cpCtx.editing = false;
  });
}

// ---------- 时间段卡片 ----------
function sectionOptions(sel) {
  const s = currentSettings();
  let html = "";
  for (let i = 1; i <= s.classNum; i++)
    html += `<option value="${i}" ${i === sel ? "selected" : ""}>第${i}节</option>`;
  return html;
}

function renderSlotCards(slots) {
  const box = $("slotList");
  box.innerHTML = "";
  slots.forEach((sl, i) => box.appendChild(slotCard(sl, i)));
}

function slotCard(sl, idx) {
  const s = currentSettings();
  const endSec = Math.min(sl.start + sl.step - 1, s.classNum);
  const card = document.createElement("div");
  card.className = "slot-card";
  card.dataset.mode = "week";
  card.innerHTML = `
    <div class="slot-head">
      <span>时间段 ${idx + 1}</span>
      <button type="button" class="slot-remove" title="删除此时间段">×</button>
    </div>
    <button type="button" class="slot-row-btn sf-week-btn">
      <span class="sr-ico">${ICONS.calendar}</span><span class="sr-txt sf-week-label"></span>
      <span class="chev">›</span>
    </button>
    <div class="sr-hidden">
      <select class="sf-odd">${[0, 1, 2].map((v) => `<option value="${v}" ${v === sl.isOdd ? "selected" : ""}>${ODD_NAMES[v]}</option>`).join("")}</select>
      <input class="sf-sw" value="${sl.startWeek}">
      <input class="sf-ew" value="${Math.max(sl.endWeek, sl.startWeek)}">
      <input class="sf-weeks" value="${sl.weeks || ""}">
      <input type="date" class="sf-df">
      <input type="date" class="sf-dt">
    </div>
    <button type="button" class="slot-row-btn sf-time-btn">
      <span class="sr-ico">${ICONS.clock}</span><span class="sr-txt sf-time-label"></span>
      <span class="chev">›</span>
    </button>
    <div class="sr-hidden">
      <select class="sf-day">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${d === sl.day ? "selected" : ""}>${DAY_NAMES[d]}</option>`).join("")}</select>
      <select class="sf-start">${sectionOptions(Math.min(sl.start, s.classNum))}</select>
      <select class="sf-end">${sectionOptions(Math.max(1, endSec))}</select>
    </div>
    <div class="slot-custom-row">
      <label><input type="checkbox" class="sf-custom" ${sl.customTime ? "checked" : ""}>自定义时间</label>
      <div class="ct-times" ${sl.customTime ? "" : "hidden"}>
        <input type="time" class="sf-cts" value="${sl.customTime ? sl.customTime.start : "08:00"}">
        <span>~</span>
        <input type="time" class="sf-cte" value="${sl.customTime ? sl.customTime.end : "09:40"}">
      </div>
    </div>
    <div class="cf-row"><span class="cf-ico">${ICONS.teacher}</span><input type="text" class="sf-teach" maxlength="20" value="${escapeHtml(sl.teach)}" placeholder="授课老师（可不填）"></div>
    <div class="cf-row"><span class="cf-ico">${ICONS.room}</span><input type="text" class="sf-room" maxlength="30" value="${escapeHtml(sl.room)}" placeholder="教室（可不填）"></div>
  `;
  card.querySelector(".sf-week-btn").onclick = () => openWeekDlg(card);
  card.querySelector(".sf-time-btn").onclick = () => openTimeDlg(card);
  updateSlotLabels(card);
  return card;
}

// 由隐藏控件刷新卡片摘要文字
function updateSlotLabels(card) {
  const mode = card.dataset.mode;
  const sw = Number(card.querySelector(".sf-sw").value);
  const ew = Number(card.querySelector(".sf-ew").value);
  const odd = Number(card.querySelector(".sf-odd").value);
  const wl = card.querySelector(".sf-week-label");
  if (mode === "date") {
    const df = card.querySelector(".sf-df").value,
      dt = card.querySelector(".sf-dt").value;
    wl.textContent =
      df && dt ? `日期 ${df} ~ ${dt}` : "日期模式（自动换算周数）";
  } else {
    // 位串可用时按实际选中集合分段显示（支持不连续周）
    const weeksStr = card.querySelector(".sf-weeks").value;
    const label =
      /^[01]+$/.test(weeksStr) && weeksStr.includes("1")
        ? M.weeksLabel(weeksStr)
        : `第${sw} - ${ew}周`;
    wl.textContent = label + (odd ? ` · ${ODD_NAMES[odd]}` : "");
  }
  const day = Number(card.querySelector(".sf-day").value);
  const st = Number(card.querySelector(".sf-start").value);
  const en = Number(card.querySelector(".sf-end").value);
  card.querySelector(".sf-time-label").textContent =
    `${DAY_NAMES[day]} 第${st} - ${en}节`;
}

// ---------- 周次选择弹窗（点选任选 / 按住滑动连选 / 单双周模式 / 日期模式） ----------

function openWeekDlg(card) {
  const total = currentSettings().totalWeeks;
  const weeksStr = card.querySelector(".sf-weeks").value;
  let weeks;
  if (/^[01]+$/.test(weeksStr) && weeksStr.includes("1")) {
    // 位串与当前总周数对齐（学期周数变更后旧数据也能正确展示）
    weeks = weeksStr
      .padEnd(total, "0")
      .slice(0, total)
      .split("")
      .map((ch) => ch === "1");
  } else {
    const sw = Number(card.querySelector(".sf-sw").value);
    const ew = Number(card.querySelector(".sf-ew").value);
    weeks = [];
    for (let w = 1; w <= total; w++) weeks.push(w >= sw && w <= ew);
  }
  session.wdCtx = {
    card,
    weeks,
    odd: Number(card.querySelector(".sf-odd").value),
    mode: card.dataset.mode === "date" ? "date" : "week",
  };
  $("wdDf").value = card.querySelector(".sf-df").value || "";
  $("wdDt").value = card.querySelector(".sf-dt").value || "";
  renderWeekDlg();
  openModal("weekDlg");
}

function renderWeekDlg() {
  const dateMode = session.wdCtx.mode === "date";
  $("wgGrid").hidden = dateMode;
  $("wgDate").hidden = !dateMode;
  $("wgQuick").hidden = dateMode;
  $("wdModeBtn").textContent = dateMode ? "周次模式" : "日期模式";
  if (dateMode) return;

  const grid = $("wgGrid");
  const total = session.wdCtx.weeks.length;
  if (Number(grid.dataset.total) !== total) {
    // 仅在总周数变化时重建格子，滑选中只同步样式
    grid.innerHTML = "";
    grid.dataset.total = total;
    for (let w = 1; w <= total; w++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "wg-cell";
      cell.dataset.w = w;
      cell.textContent = w;
      grid.appendChild(cell);
    }
  }
  syncWeekGrid();
}

function syncWeekGrid() {
  const has = session.wdCtx.weeks.some(Boolean); // 空选择时三个模式按钮均不高亮
  $("wgGrid")
    .querySelectorAll(".wg-cell")
    .forEach((cell) => {
      cell.classList.toggle("sel", !!session.wdCtx.weeks[Number(cell.dataset.w) - 1]);
    });
  $("wgAll").classList.toggle("on", has && session.wdCtx.odd === 0);
  $("wgOdd").classList.toggle("on", has && session.wdCtx.odd === 1);
  $("wgEven").classList.toggle("on", has && session.wdCtx.odd === 2);
}

// 按住滑动经过的格子统一设为起点格按下后的状态（再滑可整段清除）
function wdApplyAt(x, y) {
  if (!session.wdCtx || session.wdCtx.mode === "date" || !session.wdDrag) return;
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest(".wg-cell") : null;
  if (!cell || !cell.dataset.w) return;
  const w = Number(cell.dataset.w);
  if (session.wdCtx.weeks[w - 1] === session.wdDrag.state) return;
  session.wdCtx.weeks[w - 1] = session.wdDrag.state;
  // 单/双周模式下选中了不符合奇偶规则的周 → 自动退出该模式（周保留）
  if (session.wdDrag.state && session.wdCtx.odd === 1 && w % 2 === 0) session.wdCtx.odd = 0;
  if (session.wdDrag.state && session.wdCtx.odd === 2 && w % 2 === 1) session.wdCtx.odd = 0;
  syncWeekGrid();
}

// 单/双周按钮：已有选中 → 当前选区过滤为对应奇偶子集（"只选一半"）；
// 过滤后为空或原本无选中 → 直接全选所有单/双周
function wdPickMode(mode) {
  if (!session.wdCtx || session.wdCtx.mode === "date") return;
  const total = session.wdCtx.weeks.length;
  if (mode === 0) {
    // 开关行为：已全选 → 再点全周 = 全不选（确定时另有空选校验兜底）
    session.wdCtx.weeks = session.wdCtx.weeks.every(Boolean)
      ? Array(total).fill(false)
      : Array(total).fill(true);
  } else {
    const parity = mode === 1 ? 1 : 0; // 单周=奇数周，双周=偶数周
    session.wdCtx.weeks = session.wdCtx.weeks.map((sel, i) => sel && (i + 1) % 2 === parity);
    if (!session.wdCtx.weeks.some(Boolean)) {
      session.wdCtx.weeks = session.wdCtx.weeks.map((_, i) => (i + 1) % 2 === parity);
    }
  }
  session.wdCtx.odd = mode;
  syncWeekGrid();
}

// ---------- 时间选择弹窗（三列点选） ----------

function openTimeDlg(card) {
  session.tpCtx = {
    card,
    day: Number(card.querySelector(".sf-day").value),
    start: Number(card.querySelector(".sf-start").value),
    end: Number(card.querySelector(".sf-end").value),
  };
  renderTimeDlg();
  openModal("timeDlg");
}

function secValList(a, b) {
  const r = [];
  for (let i = a; i <= b; i++) r.push({ value: i, label: `第${i}节` });
  return r;
}

function renderTimeDlg() {
  const s = currentSettings();
  const fill = (boxId, vals, cur, onpick) => {
    const box = $(boxId);
    box.querySelectorAll("button").forEach((b) => b.remove());
    for (const v of vals) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v.label;
      b.classList.toggle("sel", v.value === cur);
      b.onclick = () => onpick(v.value);
      box.appendChild(b);
    }
    // 选中项滚动到可视区（列已是固定高度滚动窗口）
    const sel = box.querySelector("button.sel");
    if (sel) sel.scrollIntoView({ block: "center" });
  };
  fill(
    "tpDay",
    [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: DAY_NAMES[d] })),
    session.tpCtx.day,
    (v) => {
      session.tpCtx.day = v;
      renderTimeDlg();
    },
  );
  fill("tpStart", secValList(1, s.classNum), session.tpCtx.start, (v) => {
    session.tpCtx.start = v;
    if (session.tpCtx.end < v) session.tpCtx.end = v;
    renderTimeDlg();
  });
  fill("tpEnd", secValList(session.tpCtx.start, s.classNum), session.tpCtx.end, (v) => {
    session.tpCtx.end = v;
    renderTimeDlg();
  });
}

// 时间段列表事件（委托）
function bindSlotListEvents() {
  const box = $("slotList");
  box.addEventListener("click", async (e) => {
    if (e.target.closest(".slot-remove")) {
      const cards = box.querySelectorAll(".slot-card");
      if (cards.length <= 1) {
        showToast("至少保留一个时间段");
        return;
      }
      e.target.closest(".slot-card").remove();
      renumberSlots();
    }
  });
  box.addEventListener("change", async (e) => {
    if (e.target.classList.contains("sf-custom")) {
      const card = e.target.closest(".slot-card");
      card.querySelector(".ct-times").hidden = !e.target.checked;
    }
  });
}

function renumberSlots() {
  document.querySelectorAll("#slotList .slot-card").forEach((card, i) => {
    card.querySelector(".slot-head span").textContent = "时间段 " + (i + 1);
  });
}

function readCourseForm() {
  const s = currentSettings();
  const name = $("f_name").value.trim();
  if (!name) return { err: "请填写课程名" };
  const cards = [...document.querySelectorAll("#slotList .slot-card")];
  if (!cards.length) return { err: "至少需要一个时间段" };

  const slots = [];
  for (const card of cards) {
    const start = Number(card.querySelector(".sf-start").value);
    const end = Number(card.querySelector(".sf-end").value);
    if (!start || !end || start > end)
      return { err: "存在时间段节次不合法（结束节需不小于开始节）" };

    let sw, ew, weeks;
    if (card.dataset.mode === "date") {
      const df = card.querySelector(".sf-df").value;
      const dt = card.querySelector(".sf-dt").value;
      if (!df || !dt) return { err: "日期模式需填写起止日期" };
      ({ startWeek: sw, endWeek: ew } = W.weeksFromDates(s.termStart, df, dt));
      weeks = null; // 日期模式由区间展开位串
    } else {
      sw = Number(card.querySelector(".sf-sw").value);
      ew = Number(card.querySelector(".sf-ew").value);
      if (!sw || !ew || sw > ew)
        return { err: "存在时间段周次不合法（结束周需不小于开始周）" };
      weeks = card.querySelector(".sf-weeks").value;
      if (!/^[01]+$/.test(weeks) || !weeks.includes("1"))
        return { err: "存在时间段未选择上课周次" };
    }

    let customTime = null;
    if (card.querySelector(".sf-custom").checked) {
      const cts = card.querySelector(".sf-cts").value;
      const cte = card.querySelector(".sf-cte").value;
      if (!cts || !cte || cts >= cte)
        return { err: "自定义时间不合法（结束需晚于开始）" };
      customTime = { start: cts, end: cte };
    }

    slots.push(
      M.normalizeSlot({
        day: Number(card.querySelector(".sf-day").value),
        start,
        step: end - start + 1,
        startWeek: sw,
        endWeek: ew,
        weeks,
        isOdd: Number(card.querySelector(".sf-odd").value),
        room: card.querySelector(".sf-room").value.trim(),
        teach: card.querySelector(".sf-teach").value.trim(),
        customTime,
      }),
    );
  }

  const credit = $("f_credit").value.trim();
  const course = M.normalizeCourse({
    id: session.editingCourseId,
    updatedAt: Date.now(),
    name,
    color: session.pickedColor,
    credit: credit === "" ? null : Number(credit),
    note: $("f_note").value.trim(),
    timeSlots: slots,
  });

  // 冲突软提示（跨课程）
  const others = currentSchedule().courses.filter((x) => x.id !== course.id);
  const entries = [
    ...others.flatMap((o) => o.timeSlots.map((t) => ({ course: o, slot: t }))),
    ...course.timeSlots.map((t) => ({ course, slot: t })),
  ];
  const pair = C.findConflicts(entries).find(
    (p) => p.a.course.id === course.id || p.b.course.id === course.id,
  );

  return {
    course,
    conflict: pair
      ? pair.a.course.id === course.id
        ? pair.b.course
        : pair.a.course
      : null,
  };
}

async function saveCourseFromForm() {
  const r = readCourseForm();
  if (r.err) {
    $("formTip").textContent = r.err;
    return;
  }
  if (
    r.conflict &&
    !confirm(`与课程「${r.conflict.name}」时间冲突，仍要保存吗？`)
  )
    return;
  const c = r.course;

  if (session.courseModalMode === "edit") {
    const i = currentSchedule().courses.findIndex(
      (x) => x.id === session.editingCourseId,
    );
    if (i >= 0) currentSchedule().courses[i] = c;
  } else {
    // 课程名即唯一性标识：新加课程与已有课程同名 → 时间段自动并入该课程
    // （normalizeCourse 内做段去重/周次并集/相邻拼接），避免同一门课出现多个条目
    const name = (c.name || "").trim();
    const twin =
      name &&
      currentSchedule().courses.find(
        (x) => (x.name || "").trim() === name,
      );
    if (twin) {
      twin.timeSlots = M.normalizeCourse({
        name: twin.name,
        timeSlots: [...twin.timeSlots, ...c.timeSlots],
      }).timeSlots;
      twin.updatedAt = Date.now();
      touchSchedule();
      if (!(await persist())) return;
      closeModal("courseModal");
      render();
      showToast(`已合并到同名课程「${twin.name}」`);
      return;
    }
    currentSchedule().courses.push(c);
  }
  touchSchedule();
  if (!(await persist())) return;
  closeModal("courseModal");
  render();
  showToast(session.courseModalMode === "edit" ? "修改成功" : "添加成功");
}

// ---------- 删除（点垃圾桶 → 弹窗三选一：本节课 / 此时间段 / 整门课程） ----------
function removeCourse(id) {
  const sch = currentSchedule();
  sch.courses = sch.courses.filter((x) => x.id !== id);
  sch.tombstones[id] = Date.now(); // 墓碑：防止合并时被旧数据复活
}

// 点击课程块 = 选中「这一周的这一节」：删除弹窗按 本节实例/时间段/整门课 三个范围询问
function onDeleteClick() {
  const c = findCourse(session.editingCourseId);
  if (!c) return;
  const sl = c.timeSlots.find((t) => t.id === session.editingSlotId) || c.timeSlots[0];
  const multi = c.timeSlots.length > 1;

  $("delTitle").textContent = `删除「${c.name}」`;
  const box = $("delOptions");
  box.innerHTML = "";
  const opt = (act, ico, title, desc, danger) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "share-choice" + (danger ? " danger" : "");
    b.dataset.del = act;
    b.innerHTML = `<span class="sc-ico">${ico}</span><span class="sc-txt"><b>${title}</b><small>${desc}</small></span>`;
    box.appendChild(b);
  };
  opt(
    "week",
    ICONS.calendar,
    `仅删除本节课（第${session.viewWeek}周）`,
    "只从该时间段的上课周次中移除本周，其余周照常上课",
  );
  if (multi) {
    opt(
      "slot",
      ICONS.clock,
      "删除此时间段",
      `${DAY_NAMES[sl.day]} 第${sl.start} - ${sl.start + sl.step - 1}节 · ${M.weeksLabel(sl.weeks) || `第${sl.startWeek} - ${sl.endWeek}周`}`,
    );
  }
  opt(
    "course",
    ICONS.trash,
    "删除整门课程",
    `共 ${c.timeSlots.length} 个时间段，全部移除`,
    true,
  );
  openModal("deleteModal");
}

async function execDelete(act) {
  const c = findCourse(session.editingCourseId);
  if (!c) return;
  const sl = c.timeSlots.find((t) => t.id === session.editingSlotId) || c.timeSlots[0];
  let msg;
  if (act === "week") {
    // 从该时间段的位串中摘除本周；若因此无任何上课周 → 整个时间段移除
    const bits = sl.weeks.split("");
    bits[session.viewWeek - 1] = "0";
    sl.weeks = bits.join("");
    c.updatedAt = Date.now();
    if (!sl.weeks.includes("1")) {
      c.timeSlots = c.timeSlots.filter((t) => t.id !== sl.id);
      msg = `已删除第${session.viewWeek}周的这节课（该时间段已无上课周，一并移除）`;
    } else {
      msg = `已删除第${session.viewWeek}周的这节课`;
    }
  } else if (act === "slot") {
    c.timeSlots = c.timeSlots.filter((t) => t.id !== sl.id);
    c.updatedAt = Date.now();
    msg = "已删除该时间段";
  } else {
    removeCourse(c.id);
    msg = "删除成功";
  }
  if (!c.timeSlots.length) removeCourse(c.id); // 时间段删光 = 整门课删除
  touchSchedule();
  if (!(await persist())) return;
  closeModal("deleteModal");
  closeModal("courseModal");
  render();
  showToast(msg);
}

// 从卡片读取单个 slot（btnAddSlot 复制上一时间段用），失败返回 {err}
function readSlotFromCard(card) {
  const s = currentSettings();
  const start = Number(card.querySelector(".sf-start").value);
  const end = Number(card.querySelector(".sf-end").value);
  if (!start || !end || start > end)
    return { err: "上一时间段节次不合法，无法复制" };
  let sw = Number(card.querySelector(".sf-sw").value);
  let ew = Number(card.querySelector(".sf-ew").value);
  if (!sw || !ew || sw > ew) {
    sw = 1;
    ew = s.totalWeeks;
  }
  const weeksStr = card.querySelector(".sf-weeks").value;
  const weeks =
    /^[01]+$/.test(weeksStr) && weeksStr.includes("1") ? weeksStr : null;
  let customTime = null;
  if (card.querySelector(".sf-custom").checked) {
    const cts = card.querySelector(".sf-cts").value;
    const cte = card.querySelector(".sf-cte").value;
    if (cts && cte && cts < cte) customTime = { start: cts, end: cte };
  }
  return M.normalizeSlot({
    day: Number(card.querySelector(".sf-day").value),
    start,
    step: end - start + 1,
    startWeek: sw,
    endWeek: ew,
    weeks,
    isOdd: Number(card.querySelector(".sf-odd").value),
    room: card.querySelector(".sf-room").value.trim(),
    teach: card.querySelector(".sf-teach").value.trim(),
    customTime,
  });
}

export { openCourseModal, slotTimeText, renderCourseDetail, fillCourseForm, pickedHex, updateColorUI, openCustomPicker, renderCustomPicker, applyPickerColor, bindPickerDrag, sectionOptions, renderSlotCards, slotCard, updateSlotLabels, openWeekDlg, renderWeekDlg, syncWeekGrid, wdApplyAt, wdPickMode, openTimeDlg, secValList, renderTimeDlg, bindSlotListEvents, renumberSlots, readCourseForm, saveCourseFromForm, removeCourse, onDeleteClick, execDelete, readSlotFromCard, cpCtx };
