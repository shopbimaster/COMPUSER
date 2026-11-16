// campuser · grid
import { currentSchedule, currentSettings, escapeHtml, DAY_ABBR, Ports, $, session, W, C, fmtDate, toMin } from "./context.mjs";
import { courseBlockStyle } from "./colors.mjs";
import { openCourseModal } from "./course-editor.mjs";
import { closeModal } from "./dialogs.mjs";
import { switchSchedule } from "./schedules.mjs";
import { openAdjustMoveModal, openDayAdjustMenu } from "./adjustments.mjs";

// 展开为渲染条目：{course, slot}
function allEntries() {
  return currentSchedule().courses.flatMap((c) =>
    c.timeSlots.map((t) => ({ course: c, slot: t })),
  );
}

// ---------- 周计算（薄封装到当前课表） ----------
function calcCurrentWeek() {
  return W.calcCurrentWeek(currentSettings().termStart);
}
function dayDate(w, day) {
  return W.dayDate(currentSettings().termStart, w, day);
}

// ---------- 渲染 ----------
function dayOrder() {
  return currentSettings().sundayFirst
    ? [7, 1, 2, 3, 4, 5, 6]
    : [1, 2, 3, 4, 5, 6, 7];
}

function render(reflowed) {
  renderInto($("grid"), session.viewWeek, { main: true });
  renderNeighbors();
  // 内容撑出滚动条后列宽会收缩，首帧推导的 gap 可能偏大 1px：
  // 首帧渲染完成后实测列宽复核一次，仅重排一帧（reflowed 防循环）
  if (!reflowed) {
    requestAnimationFrame(() => {
      const col0 = $("grid").querySelector(".day-col");
      if (!col0) return;
      const g2 = Math.round(
        col0.getBoundingClientRect().width *
          (currentSettings().courseGap / 100),
      );
      if (g2 !== session.gapPx) render(true);
    });
  }
}

// 预渲染当前周的左右相邻页（三页轨道模型）：滑动直接跟手无缝切换；
// 越界侧留空。在每次 render（含滑动 commit 后）调用 → 自动释放不相邻页
function renderNeighbors() {
  const s = currentSettings();
  const gl = document.getElementById("gridL");
  const gr = document.getElementById("gridR");
  if (!gl || !gr) return;
  if (session.viewWeek > 1) renderInto(gl, session.viewWeek - 1);
  else gl.innerHTML = "";
  if (session.viewWeek < s.totalWeeks) renderInto(gr, session.viewWeek + 1);
  else gr.innerHTML = "";
}

// 命中时间轴各行（首尾各放宽一个边距容差），返回节次下标（0 基）
function hitSection(y, axis, gapPx) {
  let secIdx = axis.rows.length - 1;
  for (let i = 0; i < axis.rows.length; i++) {
    if (y < axis.rows[i].y1 + gapPx) {
      secIdx = i;
      break;
    }
  }
  return secIdx;
}

// ---------- 手机端单点加课（tap-select） ----------

function clearTapSelect() {
  if (session.tapSel) {
    session.tapSel.el.remove();
    session.tapSel = null;
  }
}

// 在空位放置/更新粉色选中块：再次点按选中块进入新建课程（时间按选中区域预填），
// 选中块滑动伸缩：上滑 = 顶边向上延长，下滑 = 底边向下延长（边缘跟随手指，
// 反向滑动可缩回；一次触摸拖一个边缘，由首个滑动方向决定拖哪个边缘）
function buildTapBlock(col, axis, day, start, step, g, itemHeight) {
  clearTapSelect();
  const el = document.createElement("div");
  el.className = "course-block tap-select";
  const place = (st, sp) => {
    const r0 = axis.rows[st - 1];
    const r1 = axis.rows[Math.min(st + sp - 1, axis.rows.length) - 1];
    el.style.top = r0.y0 + "px";
    el.style.height = r1.y1 - r0.y0 + "px";
  };
  place(start, step);
  el.style.left = g + "px";
  el.style.right = g + "px";
  el.innerHTML = '<span class="tap-plus">＋</span>';

  let dragY = 0;
  let dragEdge = null; // 'top' | 'bottom'，由首个有效滑动方向决定
  el.addEventListener(
    "touchstart",
    (ev) => {
      dragY = ev.touches[0].clientY;
      dragEdge = null;
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (ev) => {
      ev.preventDefault(); // 伸缩期间不滚动页面
      if (!session.tapSel) return;
      const y = ev.touches[0].clientY;
      const per =
        axis.rows.length > 1 ? axis.rows[1].y0 - axis.rows[0].y0 : itemHeight;
      const delta = Math.round((y - dragY) / per);
      if (!delta) return;
      if (!dragEdge) dragEdge = delta > 0 ? "bottom" : "top";
      if (dragEdge === "bottom") {
        // 底边跟手：下滑延长、上滑缩短，起始节不变
        const st2 = Math.max(
          1,
          Math.min(axis.rows.length - session.tapSel.start + 1, session.tapSel.step + delta),
        );
        if (st2 !== session.tapSel.step) {
          session.tapSel.step = st2;
          place(session.tapSel.start, st2);
        }
      } else {
        // 顶边跟手：上滑延长、下滑缩短，末节不变
        const s2 = Math.max(
          1,
          Math.min(session.tapSel.start + delta, session.tapSel.start + session.tapSel.step - 1),
        );
        if (s2 !== session.tapSel.start) {
          session.tapSel.step = session.tapSel.start + session.tapSel.step - s2;
          session.tapSel.start = s2;
          place(s2, session.tapSel.step);
        }
      }
      dragY = y; // 基准跟随手指，连续滑动平滑累计
    },
    { passive: false },
  );
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const sel = session.tapSel ? { ...tapSel, el: undefined } : { day, start, step };
    clearTapSelect();
    openCourseModal("add", null, null, {
      day: sel.day,
      start: sel.start,
      step: sel.step,
    });
  });
  session.tapSel = { day, start, step, el };
  col.appendChild(el);
  haptic(); // 开始加课（选中块出现）：短暂震动反馈
}

// 渲染任意周到任意网格容器（主 grid 或三页滑动轨道的相邻页 gridL/gridR）
function renderInto(gridEl, week, opts = {}) {
  const main = !!opts.main;
  const s = currentSettings();
  const todayStr = fmtDate(new Date());
  const days = dayOrder();
  if (Ports.platform === "android") clearTapSelect(); // 重渲后旧选中块失效
  // 周六/周日独立开关（旧 showWeekend 已迁移）；关闭仅隐藏对应列
  const visibleDays = days.filter(
    (d) => d <= 5 || (d === 6 && s.showSaturday) || (d === 7 && s.showSunday),
  );

  gridEl.style.setProperty("--day-count", visibleDays.length);
  // 列衬底：课表为空时不铺（避免空表满屏白色列底）；
  // 深色模式切换 class（浅色=卡片色比背景浅 / 深色=黑色叠加比背景深）
  const hasCourses = currentSchedule().courses.length > 0;
  gridEl.style.setProperty(
    "--col-bg-a",
    hasCourses && s.showColBg ? s.colBgAlpha / 100 : 0,
  );
  gridEl.classList.toggle(
    "col-bg-dark",
    hasCourses && s.showColBg && !!s.colBgDark,
  );
  // 深色衬底：黑色叠加量按主题背景明度折算，使「变深幅度」与浅色衬底「变浅幅度」对称
  // （纯黑用与浅色相同的 α 时明度差会放大 ~10 倍，日间模式近乎全黑）
  const darkTheme = document.documentElement.dataset.theme === "dark";
  gridEl.style.setProperty(
    "--col-bg-a-dark",
    hasCourses && s.showColBg && !!s.colBgDark
      ? (s.colBgAlpha / 100) * (darkTheme ? 0.7 : 0.1)
      : 0,
  );
  gridEl.style.setProperty("--header-fs", s.headerTextSize + "px");
  gridEl.style.setProperty("--ow-alpha", s.otherWeekAlpha / 100);
  // 列衬底圆角与课程格子圆角动态一致
  gridEl.style.setProperty("--col-radius", s.cornerRadius + "px");

  // 课程格子边距 = 列宽 × 设置%（0-10，normalize 已限界）。
  // 列宽必须在清空内容前从上一帧实测（清空后滚动条消失、clientWidth 会虚大）；
  // 首帧无旧列可测时按布局公式估算：40px 时间列 + 每列列缝（读 computed，窄屏 2px/桌面 4px）
  const prevCol = gridEl.querySelector(".day-col");
  const colGapPx = parseFloat(getComputedStyle(gridEl).columnGap) || 4;
  const colW = prevCol
    ? prevCol.getBoundingClientRect().width
    : Math.max(
        0,
        (gridEl.clientWidth - 40 - visibleDays.length * colGapPx) /
          Math.max(1, visibleDays.length),
      );
  const g = Math.round(colW * (s.courseGap / 100));
  if (main) session.gapPx = g; // 全局 session.gapPx 供双击命中等旧引用；目标页渲染用局部 g
  // 节次列左右余量 = 衬底间距（CSS max-content 列宽 + var(--gap) padding）
  gridEl.style.setProperty("--gap", g + "px");

  // 时间轴：均匀分节网格 + 节内线性插值（自定义时间块按真实时刻无缝嵌入）
  const axis = buildTimeAxis(s, g);
  gridEl.innerHTML = "";

  const corner = document.createElement("div");
  corner.className = "grid-corner";
  const weekMonday = dayDate(week, 1);
  // 月份角格与周表头同构：数字在上、「月」字在下（与周几/日期的上下结构一致）
  corner.innerHTML = `<span class="month">${weekMonday.getMonth() + 1}</span><span class="month-sub">月</span>`;
  gridEl.appendChild(corner);

  for (const d of visibleDays) {
    const date = dayDate(week, d);
    const h = document.createElement("div");
    h.className =
      "day-header" + (fmtDate(date) === todayStr ? " is-today" : "");
    h.innerHTML = `<span class="day-name">${DAY_ABBR[d]}</span><span class="day-date">${date.getDate()}</span>`;
    // 点击表头：弹出「整日调课」入口
    h.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openDayAdjustMenu(h, d, fmtDate(date));
    });
    gridEl.appendChild(h);
  }

  const timeCol = document.createElement("div");
  timeCol.className = "time-col";
  // max-content 列宽不计算 absolute 子元素：用隐形 sizer 把列撑到时间文字宽度
  const sizer = document.createElement("div");
  sizer.className = "col-sizer";
  sizer.textContent = "08:00";
  timeCol.appendChild(sizer);
  for (let i = 1; i <= s.classNum; i++) {
    const r = axis.rows[i - 1];
    const sec = document.createElement("div");
    sec.className = "sec";
    sec.style.top = r.y0 + "px";
    sec.style.height = r.y1 - r.y0 + "px";
    sec.innerHTML = `<span class="sec-no">${i}</span><span>${s.times[i - 1].start}</span><span>${s.times[i - 1].end}</span>`;
    timeCol.appendChild(sec);
  }
  gridEl.appendChild(timeCol);

  for (const d of visibleDays) {
    const col = document.createElement("div");
    col.className = "day-col";
    col.dataset.day = d;
    // 衬底长度 = 时间轴总高（各节按时长占比 + 节间空隙 + 首尾各一个边距）
    col.style.height = axis.totalH + "px";

    const dayEntries = allEntries()
      .filter((e) => e.slot.day === d)
      .sort((a, b) => entryStartMin(a) - entryStartMin(b));

    // 「显示下周课程」：本周课正常显示（实色）；下一周独有的课叠加显示
    // （半透明 other-week，透明度由 otherWeekAlpha 驱动）。按
    // 课程+时间段位置去重——本周已显示的位置不叠加下周的同一节课。
    const shown = new Set();
    const entryKey = (e) =>
      `${e.course.id}:${e.slot.day}:${e.slot.start}:${e.slot.step}`;
    for (const e of dayEntries) {
      const inWeek = C.slotInWeek(e.slot, week);
      if (!inWeek) continue; // 旧「非本周灰显」语义已改为叠加下周
      col.appendChild(buildCourseBlock(e, true, axis, g));
      shown.add(entryKey(e));
    }
    if (s.showOtherWeek && week + 1 <= s.totalWeeks) {
      for (const e of dayEntries) {
        if (!C.slotInWeek(e.slot, week + 1)) continue;
        const key = entryKey(e);
        if (shown.has(key)) continue; // 本周已有该课，不叠加
        col.appendChild(buildCourseBlock(e, false, axis, g));
        shown.add(key);
      }
    }

    if (main) {
      if (Ports.platform === "android") {
        // 手机端单点加课：点击空位出现粉色选中块（加号居中），
        // 选中后上下拖动调整时段（从块上半拖向上扩展、下半拖向下扩展），
        // 再点选中块进入新建课程（时间已按选中区域预填）。
        // 已有选中时点击其他位置：第一次仅取消选中，再点才在新位置选课
        col.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (session.tapSel) {
            clearTapSelect();
            return;
          }
          const rect = col.getBoundingClientRect();
          const secIdx = hitSection(ev.clientY - rect.top, axis, session.gapPx);
          buildTapBlock(col, axis, d, secIdx + 1, 1, g, s.itemHeight);
        });
      } else {
        col.addEventListener("dblclick", (ev) => {
          const secIdx = hitSection(
            ev.clientY - col.getBoundingClientRect().top,
            axis,
            session.gapPx,
          );
          openCourseModal("add", null, null, { day: d, start: secIdx + 1 });
        });
      }
    }

    gridEl.appendChild(col);
  }

  if (main) {
    $("emptyTip").hidden = currentSchedule().courses.length !== 0;
    updateWeekUI();
  }
}

// 排序用：条目开始分钟数（自定义时间优先，否则按节次时间）
function entryStartMin(e) {
  const s = currentSettings();
  if (e.slot.customTime) return toMin(e.slot.customTime.start);
  return toMin(s.times[Math.min(e.slot.start, s.classNum) - 1].start);
}

// ---------- 时间轴布局 ----------
// 行网格保持均匀分节（每节固定 itemHeight 高），不随节时长改变间隔；
// 垂直节间距 = 课程间间距 = 课程与列衬底间距 + 2px（水平内缩仍为衬底间距）；
// 课程块上下不加内缩贴行槽。自定义时间块不改分节：其起止时刻在各节的范围内
// 线性插值定位（节内按时长比例、节间跨空隙过渡），从而无缝嵌入均匀网格
function buildTimeAxis(s, gapPx) {
  const rows = [];
  const vGap = gapPx + 2; // 课程块之间的垂直间隙（衬底间距 + 2px）
  for (let i = 0; i < s.classNum; i++) {
    const st = toMin(s.times[i].start);
    let en = toMin(s.times[i].end);
    if (en <= st) en = st + 1; // 容错：起止颠倒按 1 分钟
    const y0 = i * (s.itemHeight + vGap) + gapPx;
    rows.push({ st, en, y0, y1: y0 + s.itemHeight });
  }
  const t2y = (t) => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (t <= first.st) return first.y0;
    if (t >= last.en) return last.y1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (t >= r.st && t <= r.en)
        return r.y0 + ((t - r.st) / Math.max(1, r.en - r.st)) * (r.y1 - r.y0);
      const nx = rows[i + 1];
      if (nx && t > r.en && t < nx.st)
        return r.y1 + ((t - r.en) / Math.max(1, nx.st - r.en)) * (nx.y0 - r.y1);
    }
    return last.y1;
  };
  return {
    rows,
    totalH: s.classNum * s.itemHeight + (s.classNum - 1) * vGap + 2 * gapPx,
    t2y,
  };
}

function buildCourseBlock(e, isCurrent, axis, gap) {
  const s = currentSettings();
  const { course: c, slot: sl } = e;
  const el = document.createElement("div");
  el.className = "course-block" + (isCurrent ? "" : " other-week");

  // 起止时刻 → 时间轴纵坐标：自定义时间块按节内线性插值定位（分节间隔不变），
  // 普通课即所在节行边界；块间垂直间隙与左右内缩同为 1×边距（1:1），块贴行槽
  const last = axis.rows.length - 1;
  const bs = sl.customTime
    ? toMin(sl.customTime.start)
    : axis.rows[Math.min(sl.start - 1, last)].st;
  const be = sl.customTime
    ? toMin(sl.customTime.end)
    : axis.rows[Math.min(sl.start + sl.step - 1, last + 1) - 1].en;
  const top = axis.t2y(bs);
  const height = Math.max(14, axis.t2y(be) - axis.t2y(bs));
  el.style.top = top + "px";
  el.style.height = height + "px";
  // 格子相对衬底左右内缩 = 课程格子边距（衬底整列不变，格子变小）
  el.style.left = gap + "px";
  el.style.right = gap + "px";

  const style = courseBlockStyle(c);
  el.style.background = style.bg;
  // 文字颜色：auto=按格子色亮度自动；black/white 为用户强制指定
  if (s.courseTextColor === "black") el.style.color = "#26282e";
  else if (s.courseTextColor === "white") el.style.color = "#ffffff";
  else el.style.color = style.text;
  el.style.fontSize = s.courseTextSize + "px";
  el.style.borderRadius = s.cornerRadius + "px";
  if (s.textHCenter) el.classList.add("txt-hcenter");
  if (s.textVCenter) el.classList.add("txt-vcenter");

  let html = "";
  if (sl.isOdd === 1) html += `<div class="course-tag">单周</div>`;
  if (sl.isOdd === 2) html += `<div class="course-tag">双周</div>`;
  if (sl.customTime)
    html += `<div class="course-tag">${sl.customTime.start}~${sl.customTime.end}</div>`;
  if (s.showTimeInGrid && !sl.customTime)
    html += `<div class="course-sec">${sl.start}-${sl.start + sl.step - 1}节</div>`;
  html += `<div class="course-name">${escapeHtml(c.name)}</div>`;
  if (s.showTeachInGrid && sl.teach)
    html += `<div class="course-teach">${escapeHtml(sl.teach)}</div>`;
  if (sl.room) html += `<div class="course-room">@${escapeHtml(sl.room)}</div>`;
  // 预留接口：showNoteInGrid（备注展示于格子内）待排版方案确定后接入
  el.innerHTML = html;

  el.title =
    `${c.name} ${sl.room ? "@" + sl.room : ""} ${sl.teach ? sl.teach + " 老师" : ""}`.trim();
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    // 拖动调课结束后的合成 click 不打开详情：仅吞「同一块 + 短时间窗」内的 click，
    // 避免全局开关误吞拖动期间其他课程的正常点击（详情打不开）
    if (
      session.suppressClick &&
      session.suppressClick.el === el &&
      Date.now() - session.suppressClick.t < 500
    ) {
      session.suppressClick = null;
      return;
    }
    // 手机端选中加课状态下点课程：仅取消选中，不打开详情
    if (session.tapSel) {
      clearTapSelect();
      return;
    }
    openCourseModal("view", c, sl);
  });
  // 长按进入拖动调课（仅当前周实课；下周叠加块与自定义时间块不参与）
  if (isCurrent && !sl.customTime) attachCourseDrag(el, c, sl);
  return el;
}

// ---------- 课程长按拖动调课 ----------
const DRAG_PRESS_MS = 1000; // 长按进入拖动的判定时长（用户权威：1 秒，彻底区分点击与拖动）
const DRAG_JITTER = 10; // 按下后的抖动容差：位移超此值取消长按（放行滚动）
const DRAG_MIN_MOVE = 12; // 进入拖动后的最小有效位移（px）：低于此值释放视为误触，静默复位不弹调课
// 拖动释放后短暂吞「同一块」的合成 click（替代旧全局布尔：跨块误吞其他课程详情）

// 触觉反馈：手机端进入拖动/开始加课时短暂震动（桌面无 vibrate 自动跳过）
function haptic() {
  if (navigator.vibrate) navigator.vibrate(30);
}

// 触摸优先设备（Android WebView / 触屏浏览器）：tap 会合成 mousedown/mouseup。
// 若启用鼠标拖动路径，合成 mousedown 会在每次 tap 后重启长按定时器，1 秒后凭空
// 激活「幽灵 drag」；随后用户在弹窗内点按钮的合成 mouseup 冒泡到 window 级监听，
// finishDrag 以该按钮坐标命中下方课表格 → 弹出目标莫名的调课窗。
// 触摸路径已完整覆盖拖动，触摸优先设备整体禁用鼠标路径。
// 每次绑定课程块时求值（跟随 platform 运行时变化，也便于按平台分别测试）
function isTouchOnly() {
  return (
    Ports.platform === "android" ||
    (navigator.maxTouchPoints > 0 &&
      window.matchMedia("(pointer: coarse)").matches)
  );
}

function attachCourseDrag(el, c, sl) {
  const touchOnly = isTouchOnly();
  let pressTimer = null;
  let pressX = 0;
  let pressY = 0;
  let drag = null; // {x0, y0} 进入拖动时的识别点（视口坐标）

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const beginDrag = (x, y) => {
    if (session.tapSel) clearTapSelect(); // 与加课选中互斥
    drag = { x0: x, y0: y };
    el.classList.add("dragging");
    document.body.classList.add("course-drag-active"); // 拖动中禁文本选择
    haptic(); // 进入拖动：短暂震动反馈
    // 鼠标拖动：监听升级到 window（拖太快指针跑出元素事件不丢）。
    // 触摸设备不挂——合成 mouseup 会冒泡到 window 误触发 finishDrag（幽灵调课窗）
    if (!touchOnly) {
      window.addEventListener("mousemove", onWinMouseMove);
      window.addEventListener("mouseup", onWinMouseUp);
    }
  };

  const updateDrag = (x, y) => {
    if (!drag) return;
    el.style.transform = `translate(${x - drag.x0}px, ${y - drag.y0}px)`;
  };

  // 统一收尾：清拖动态 class/transform/全局鼠标监听（正常释放与异常中断共用，杜绝悬空残留）
  const cleanupDrag = () => {
    drag = null;
    el.classList.remove("dragging");
    document.body.classList.remove("course-drag-active");
    el.style.transform = "";
    window.removeEventListener("mousemove", onWinMouseMove);
    window.removeEventListener("mouseup", onWinMouseUp);
  };

  const finishDrag = (x, y) => {
    // 最小位移守卫：进入拖动后基本没动（<12px）→ 视为长按误触，静默复位不弹调课窗
    // （兜住「点击详情/退出详情时手指停在课程上略久」误激活拖动的场景）
    const moved = drag ? Math.hypot(x - drag.x0, y - drag.y0) : 0;
    // 释放点 = 拖动中的块中心：必须先取 rect 再复位 transform，否则读回原位
    const rect = el.getBoundingClientRect();
    cleanupDrag();
    session.suppressClick = { el, t: Date.now() }; // 拖动后的合成 click 不打开详情（仅限本块）
    if (moved < DRAG_MIN_MOVE) return;
    const cx = rect.left + rect.width / 2;
    let colEl = null;
    for (const cEl of document.querySelectorAll("#grid .day-col")) {
      const r = cEl.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right) {
        colEl = cEl;
        break;
      }
    }
    if (!colEl) return; // 拖出课表区域 → 取消（块已回弹原位）
    const s = currentSettings();
    const axis = buildTimeAxis(s, session.gapPx);
    const colRect = colEl.getBoundingClientRect();
    const toDay = Number(colEl.dataset.day);
    // 目标起始节 = 与块覆盖区间重叠像素最多的整课程格（块压到哪几节多就吸到哪），
    // 而非按顶边/中心单点命中
    const y0 = rect.top - colRect.top;
    const y1 = rect.bottom - colRect.top;
    let toStart = 1;
    let bestOv = -1;
    for (let k = 1; k + sl.step - 1 <= s.classNum; k++) {
      const g0 = axis.rows[k - 1].y0;
      const g1 = axis.rows[k + sl.step - 2].y1;
      const ov = Math.min(y1, g1) - Math.max(y0, g0);
      if (ov > bestOv) {
        bestOv = ov;
        toStart = k;
      }
    }
    // 落点仍在原位（同天同起始节）→ 不弹调课选项，静默复位
    if (toDay === sl.day && toStart === sl.start) return;
    openAdjustMoveModal(c, sl, toDay, toStart);
  };

  // 异常中断（系统截图/来电/手势打断 → touchcancel，或窗口失焦/页面隐藏）：
  // 静默回弹原位，不弹调课窗——否则 drag 状态与 transform 残留，课程块悬空
  const cancelDrag = () => {
    if (!drag) return;
    cleanupDrag();
    session.suppressClick = { el, t: Date.now() };
  };

  const pressMove = (x, y) => {
    if (drag) {
      updateDrag(x, y);
      return;
    }
    // 未进入拖动的移动超容差 → 取消长按（放行滚动/周切换）
    if (
      Math.abs(x - pressX) > DRAG_JITTER ||
      Math.abs(y - pressY) > DRAG_JITTER
    )
      cancelPress();
  };

  el.addEventListener(
    "touchstart",
    (e) => {
      cancelPress(); // 任何新触摸（含多点）先清长按定时，防残留误判拖动
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      pressX = t.clientX;
      pressY = t.clientY;
      pressTimer = setTimeout(() => beginDrag(pressX, pressY), DRAG_PRESS_MS);
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      if (!drag) {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        pressMove(t.clientX, t.clientY);
        return;
      }
      e.preventDefault(); // 拖动中禁止页面滚动
      // 多点容错：始终跟第一指（拖快时误触第二指不卡住、不跳变）
      const t = e.touches[0] || e.changedTouches[0];
      if (t) updateDrag(t.clientX, t.clientY);
    },
    { passive: false },
  );
  el.addEventListener(
    "touchend",
    (e) => {
      cancelPress();
      if (!drag) return;
      const t = e.changedTouches[0];
      finishDrag(t ? t.clientX : pressX, t ? t.clientY : pressY);
    },
    { passive: true },
  );
  el.addEventListener("touchcancel", cancelDrag);
  if (!touchOnly) {
    // 鼠标拖动路径（仅桌面）：触摸设备上 tap 合成的 mousedown/mouseup 会制造
    // 幽灵 drag + 误触发 finishDrag，整条路径禁用（触摸路径已完整覆盖拖动）
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      cancelPress();
      pressX = e.clientX;
      pressY = e.clientY;
      pressTimer = setTimeout(() => {
        beginDrag(pressX, pressY);
        // 拖动中鼠标监听升级到 window：拖太快指针跑出元素，事件不再丢失
        window.addEventListener("mousemove", onWinMouseMove);
        window.addEventListener("mouseup", onWinMouseUp);
      }, DRAG_PRESS_MS);
    });
    el.addEventListener("mousemove", (e) => pressMove(e.clientX, e.clientY)); // 未拖动：容差取消长按
    el.addEventListener("mouseleave", () => {
      if (!drag) cancelPress();
    });
  }
  const onWinMouseMove = (e) => updateDrag(e.clientX, e.clientY);
  const onWinMouseUp = (e) => {
    cancelPress();
    if (!drag) return;
    finishDrag(e.clientX, e.clientY);
  };
  // 窗口失焦/页面隐藏（任务栏截图、alt-tab 等）：取消长按与拖动，回弹防悬空
  window.addEventListener("blur", () => {
    cancelPress();
    cancelDrag();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelPress();
      cancelDrag();
    }
  });
} // ---------- 顶栏与周数面板 ----------
function weekStatusText() {
  const s = currentSettings();
  const cur = calcCurrentWeek();
  if (session.viewWeek > s.totalWeeks) return "学期结束";
  if (cur < 1) return "未开学";
  if (session.viewWeek !== cur) return "非本周";
  return "";
}

function updateWeekUI() {
  $("weekLabel").textContent = `第 ${session.viewWeek} 周`;
  $("weekStatus").textContent = weekStatusText();
  // 标题行：课表名（大）+ 周序数（小）同行，均可设置关闭；两项全关仅剩切周箭头
  const s = currentSettings();
  const name = $("schName");
  name.textContent = currentSchedule().name;
  name.hidden = !s.showSchName;
  $("weekTitleSpan").hidden = !s.showWeekTitle;
  const d = new Date();
  $("todayInfo").textContent =
    `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const slider = $("wpSlider");
  slider.max = s.totalWeeks;
  slider.value = session.viewWeek;
  $("wpVal").textContent = `第${session.viewWeek}周`;
  renderSchCards();
}

function renderSchCards() {
  const box = $("schCards");
  box.innerHTML = "";
  for (const s of session.state.schedules) {
    const card = document.createElement("div");
    card.className =
      "sch-card" + (s.id === session.state.currentScheduleId ? " active" : "");
    card.innerHTML = `${s.id === session.state.currentScheduleId ? '<span class="sc-check">✓</span>' : ""}
      <span>${escapeHtml(s.name)}</span><span class="sc-count">${s.courses.length} 门课</span>`;
    card.onclick = () => {
      switchSchedule(s.id);
      closeModal("weekPanel");
    };
    box.appendChild(card);
  }
}

function setViewWeek(w) {
  session.viewWeek = Math.min(currentSettings().totalWeeks, Math.max(1, w));
  updateWeekUI();
  render();
}

export { allEntries, calcCurrentWeek, dayDate, dayOrder, render, renderNeighbors, hitSection, clearTapSelect, buildTapBlock, renderInto, entryStartMin, buildTimeAxis, buildCourseBlock, haptic, isTouchOnly, attachCourseDrag, weekStatusText, updateWeekUI, renderSchCards, setViewWeek, DRAG_PRESS_MS, DRAG_JITTER, DRAG_MIN_MOVE };
