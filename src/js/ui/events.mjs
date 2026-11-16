// campuser · events
import { currentSettings, findCourse, showToast, M, Ports, $, session, W, addMinutes } from "./context.mjs";
import { hexToHsv } from "./colors.mjs";
import { calcCurrentWeek, render, clearTapSelect, updateWeekUI, setViewWeek } from "./grid.mjs";
import { openCourseModal, pickedHex, updateColorUI, openCustomPicker, renderCustomPicker, applyPickerColor, bindPickerDrag, slotCard, updateSlotLabels, renderWeekDlg, wdApplyAt, wdPickMode, bindSlotListEvents, renumberSlots, saveCourseFromForm, onDeleteClick, execDelete, readSlotFromCard, cpCtx } from "./course-editor.mjs";
import { openModal, closeModal } from "./dialogs.mjs";
import { bindScheduleManager } from "./schedules.mjs";
import { openSettings, saveSettings } from "./settings.mjs";
import { toggleTheme } from "./today.mjs";
import { toggleMenu, doExportAction, doImportAction } from "./transfer.mjs";
import { applyAdjustMove, confirmAdjustDay } from "./adjustments.mjs";
import { doImportAsNew, applyCurrentSettingsTo, confirmImportChoice, confirmIcsFormat } from "./imports.mjs";

// ---------- 事件绑定 ----------
function bindEvents() {
  // 周切换：箭头 / 滑杆 / 键盘 / 触摸板
  $("prevWeek").onclick = (e) => {
    e.stopPropagation();
    setViewWeek(session.viewWeek - 1);
  };
  $("nextWeek").onclick = (e) => {
    e.stopPropagation();
    setViewWeek(session.viewWeek + 1);
  };

  // 触屏左右滑动切换周次（手机端隐藏切周箭头后的替代交互）：三页轨道——
  // 静止时当前页 + 左右相邻页均已预渲染。滑动识别优先于点击：首个有效位移即
  // 判方向并立即跟手（基准重置到识别点，识别前已滑距离不计入 → 无跳帧卡顿）；
  // 中途反方向滑亦无缝（两侧页常备），commit 时按最终位移方向确定目标周。
  // 抬手时位移过短判为点击（放行合成 click），拖动过则吞掉合成 click；
  // 纵向滚动优先，越界周不启动
  (() => {
    const wrap = document.querySelector(".schedule-wrap");
    const track = document.getElementById("weekTrack");
    const HOME = "translateX(-100%)"; // 静止位：当前页（中格）居中可见
    let sx = 0,
      sy = 0,
      sx0 = 0, // 最初触点：commit/点击的距离判定按总位移（识别前的滑动也计入）
      st = 0;
    let swiping = false; // 已进入横向拖拽（跟手基准 = sx）
    let dead = false; // 本次触摸已判定为纵向滚动/越界/动画未完

    wrap.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        if (track.classList.contains("sliding")) {
          dead = true; // 切换动画进行中：不打断（避免把动画中的页面瞬拉回原位）
          return;
        }
        sx = sx0 = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        st = Date.now();
        swiping = false;
        dead = false;
        track.style.transform = HOME;
      },
      { passive: true },
    );

    wrap.addEventListener(
      "touchmove",
      (e) => {
        if (dead || e.touches.length !== 1) return;
        // 课程块长按拖动中：禁用周翻页识别（否则块与轨道同向跟手呈二倍速偏移）
        if (document.body.classList.contains("course-drag-active")) {
          if (swiping) {
            swiping = false;
            track.style.transform = HOME; // 已误入跟手则立即弹回
          }
          dead = true;
          return;
        }
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dx = x - sx;
        const dy = y - sy;
        if (!swiping) {
          // 静默微动：位移过小不判向（避免点击抖动误入拖拽）
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            dead = true;
            return;
          } // 纵向滚动优先
          // 横向识别：基准重置到当前点（跟手从识别点起算，无跳帧）
          const finalTarget = session.viewWeek + (dx < 0 ? 1 : -1);
          if (finalTarget < 1 || finalTarget > currentSettings().totalWeeks) {
            dead = true;
            return;
          }
          sx = x;
          swiping = true;
          return;
        }
        // 待滑动状态：两侧相邻页均已预渲染，逐帧跟手；中途反悔换方向无缝
        track.style.transform = `translateX(calc(-100% + ${x - sx}px))`;
      },
      { passive: true },
    );

    wrap.addEventListener(
      "touchend",
      (e) => {
        if (!swiping) return;
        swiping = false;
        const ex = e.changedTouches[0].clientX;
        const dxi = ex - sx; // 识别后位移（= 跟手位移量）
        if (Math.abs(dxi) <= 10) {
          // 识别后几乎没滑 → 判定为点击：弹回原位并放行合成 click
          track.classList.add("sliding");
          track.style.transform = HOME;
          setTimeout(() => track.classList.remove("sliding"), 240);
          return;
        }
        e.preventDefault(); // 拖动有效：吞掉合成 click，防止误触课程/加课
        const dx = ex - sx0; // 总位移：commit 距离与方向按用户实际滑动总量
        const w = wrap.clientWidth;
        const dt = Math.max(1, Date.now() - st);
        const flick = Math.abs(dx) / dt > 0.45; // 快速甩动
        let commit = Math.abs(dx) > w * 0.25 || (flick && Math.abs(dx) > 40);
        // commit 按最终位移方向确定目标周（中途反悔换方向以终点为准）；越界则弹回
        const dir = dx < 0 ? 1 : -1;
        const finalTarget = session.viewWeek + dir;
        if (
          commit &&
          (finalTarget < 1 || finalTarget > currentSettings().totalWeeks)
        )
          commit = false;
        track.classList.add("sliding");
        track.style.transform = commit
          ? dx < 0
            ? "translateX(-200%)" // 左滑看右邻
            : "translateX(0%)" // 右滑看左邻
          : HOME;
        setTimeout(() => {
          if (commit) {
            // 目标周转正：主 grid 渲染目标周（此刻视口正显示其内容），再复位轨道
            session.viewWeek = finalTarget;
            updateWeekUI();
            render(); // 同时重渲新的左右邻 → 释放不相邻页
          }
          track.classList.remove("sliding");
          track.style.transform = HOME; // 无动画瞬间归位（与目标页内容一致，视觉无缝）
        }, 240);
      },
      { passive: false },
    );
  })();

  // 顶栏：周标题 → 左上角小菜单（回到本周）；三点按钮 → 周数/课表/功能面板
  $("tbWeekBtn").onclick = (e) => {
    if (e.target.closest(".wk-arrow")) return;
    // 已在当前周时不弹「回到本周」菜单
    if (session.viewWeek === calcCurrentWeek()) return;
    toggleMenu("weekQuickMenu");
  };
  $("weekQuickMenu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    $("weekQuickMenu").hidden = true;
    if (b.dataset.act === "backtoday")
      setViewWeek(Math.max(1, calcCurrentWeek()));
  });
  $("btnMore").onclick = () => {
    updateWeekUI();
    openModal("weekPanel");
  };
  $("wpSlider").oninput = (e) => setViewWeek(Number(e.target.value));

  // 添加课程
  $("btnAdd").onclick = () => openCourseModal("add", null, null);

  // 周数面板功能宫格（保留 4 槽位，当前仅右侧两项）
  $("btnPanelTheme").onclick = () => toggleTheme();
  $("btnPanelSettings").onclick = () => openSettings();

  // 导入/导出菜单
  $("btnExport").onclick = (e) => {
    e.stopPropagation();
    toggleMenu("exportMenu");
  };
  $("btnImport").onclick = (e) => {
    e.stopPropagation();
    toggleMenu("importMenu");
  };
  $("exportMenu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    $("exportMenu").hidden = true;
    doExportAction(b.dataset.act);
  });
  // 分享方式选择弹窗
  $("shareChoiceModal").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-share]");
    if (!b) return;
    doExportAction("share-" + b.dataset.share);
  });
  $("importMenu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    $("importMenu").hidden = true;
    doImportAction(b.dataset.act);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap") && !e.target.closest(".dd-fixed")) {
      document.querySelectorAll(".dropdown").forEach((d) => {
        d.hidden = true;
      });
    }
    // 点任何非菜单区域都收起整日调课入口（含课表区域/标题栏）；
    // 点另一天标题栏：先冒泡到其自身处理器弹出新菜单，此处 .day-menu 豁免保留新菜单
    if (!e.target.closest(".day-menu")) {
      document.querySelectorAll(".day-menu").forEach((m) => m.remove());
    }
  });

  // 拖动调课确认窗
  $("btnAdjustCancel").onclick = () => {
    session.pendingAdjust = null;
    closeModal("adjustMoveModal");
  };
  $("btnAdjustOne").onclick = () => applyAdjustMove("one");
  $("btnAdjustAll").onclick = () => applyAdjustMove("all");
  // 整日调课
  $("btnAdjustDay").onclick = confirmAdjustDay;
  $("btnConfirmImport").onclick = confirmImportChoice;
  $("btnConfirmIcsFormat").onclick = confirmIcsFormat;
  // 导入设置统一询问：沿用当前设置（白名单覆盖 + 时间表深拷贝）或保留文件自带
  $("btnUseCurrentSettings").onclick = () => {
    const list = session.pendingImportList;
    session.pendingImportList = null;
    closeModal("importSettingsModal");
    if (!list) return;
    applyCurrentSettingsTo(list);
    doImportAsNew(list);
  };
  $("btnKeepFileSettings").onclick = () => {
    const list = session.pendingImportList;
    session.pendingImportList = null;
    closeModal("importSettingsModal");
    if (!list) return;
    doImportAsNew(list);
  };
  // 手机端：点击空白处清除单点加课选中块；系统分享面板关闭回到应用时给出反馈
  // （bindEvents 时 platform 可能未填充，回调内再判断）
  $("grid").addEventListener("click", () => {
    if (Ports.platform === "android") clearTapSelect();
  });
  document.addEventListener("campuser-resume", () => {
    if (Ports.platform !== "android") return;
    if (window.__campuserSharePending) {
      window.__campuserSharePending = false;
      showToast(
        "已通过系统分享导出；如需保存到本地，请在分享面板选「保存到文件」",
        5000,
      );
    }
  });

  // 周次选择弹窗：点选 toggle、按住滑动连选（pointer capture 后经坐标命中格子）
  $("wdModeBtn").onclick = () => {
    session.wdCtx.mode = session.wdCtx.mode === "date" ? "week" : "date";
    renderWeekDlg();
  };
  const wdGrid = $("wgGrid");
  wdGrid.addEventListener("pointerdown", (e) => {
    if (!session.wdCtx || session.wdCtx.mode === "date") return;
    const cell = e.target.closest(".wg-cell");
    if (!cell || !cell.dataset.w) return;
    e.preventDefault();
    const w = Number(cell.dataset.w);
    session.wdDrag = { state: !session.wdCtx.weeks[w - 1] };
    try {
      wdGrid.setPointerCapture(e.pointerId);
    } catch (err) {}
    wdApplyAt(e.clientX, e.clientY);
  });
  wdGrid.addEventListener("pointermove", (e) =>
    wdApplyAt(e.clientX, e.clientY),
  );
  const wdEndDrag = () => {
    session.wdDrag = null;
  };
  wdGrid.addEventListener("pointerup", wdEndDrag);
  wdGrid.addEventListener("pointercancel", wdEndDrag);
  $("wgAll").onclick = () => wdPickMode(0);
  $("wgOdd").onclick = () => wdPickMode(1);
  $("wgEven").onclick = () => wdPickMode(2);
  $("wdCancel").onclick = () => {
    session.wdCtx = null;
    closeModal("weekDlg");
  };
  $("wdOk").onclick = () => {
    if (!session.wdCtx) return;
    const card = session.wdCtx.card;
    if (session.wdCtx.mode === "date") {
      const df = $("wdDf").value,
        dt = $("wdDt").value;
      if (!df || !dt) {
        showToast("请填写起止日期");
        return;
      }
      if (df > dt) {
        showToast("开始日期需早于结束日期");
        return;
      }
      card.dataset.mode = "date";
      card.querySelector(".sf-df").value = df;
      card.querySelector(".sf-dt").value = dt;
      // 日期 → 周次区间，展开为位串
      const s = currentSettings();
      const { startWeek: sw, endWeek: ew } = W.weeksFromDates(
        s.termStart,
        df,
        dt,
      );
      card.querySelector(".sf-weeks").value = M.expandWeeks(
        Math.max(1, sw),
        Math.max(1, ew),
        0,
      );
      card.querySelector(".sf-sw").value = Math.max(1, sw);
      card.querySelector(".sf-ew").value = Math.max(1, ew);
      card.querySelector(".sf-odd").value = 0;
    } else {
      if (!session.wdCtx.weeks.some(Boolean)) {
        showToast("请至少选择一个周");
        return;
      }
      card.dataset.mode = "week";
      card.querySelector(".sf-weeks").value = session.wdCtx.weeks
        .map((v) => (v ? "1" : "0"))
        .join("");
      let sw = -1,
        ew = -1;
      session.wdCtx.weeks.forEach((v, i) => {
        if (v) {
          if (sw < 0) sw = i + 1;
          ew = i + 1;
        }
      });
      card.querySelector(".sf-sw").value = sw;
      card.querySelector(".sf-ew").value = ew;
      card.querySelector(".sf-odd").value = session.wdCtx.odd;
    }
    updateSlotLabels(card);
    session.wdCtx = null;
    closeModal("weekDlg");
  };

  // 时间选择弹窗
  $("tpCancel").onclick = () => {
    session.tpCtx = null;
    closeModal("timeDlg");
  };
  $("tpOk").onclick = () => {
    if (!session.tpCtx) return;
    const card = session.tpCtx.card;
    card.querySelector(".sf-day").value = session.tpCtx.day;
    card.querySelector(".sf-start").value = session.tpCtx.start;
    card.querySelector(".sf-end").value = session.tpCtx.end;
    updateSlotLabels(card);
    session.tpCtx = null;
    closeModal("timeDlg");
  };

  // 课程表单杂项
  // 颜色选择：按钮（颜色即时反映）→ 直接展开 SV 取色器（课名已自动随机配色，无需色板）
  $("btnToggleColor").onclick = () => {
    const row = $("customColorRow");
    if (row.hidden) openCustomPicker(pickedHex());
    else row.hidden = true;
  };
  bindPickerDrag($("cpSv"), (x, y) => {
    cpCtx.s = x;
    cpCtx.v = 1 - y;
    renderCustomPicker();
    applyPickerColor();
  });
  bindPickerDrag($("cpHue"), (x) => {
    cpCtx.h = Math.round(x * 360) % 360;
    renderCustomPicker();
    applyPickerColor();
  });
  $("ccHex").oninput = (e) => {
    const v = e.target.value.trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) {
      session.pickedColor = "#" + v.toLowerCase();
      Object.assign(cpCtx, hexToHsv(session.pickedColor));
      renderCustomPicker();
      $("btnToggleColor").style.color = session.pickedColor;
      $("ccPreview").style.background = session.pickedColor;
    }
  };
  $("btnCpCancel").onclick = () => {
    if (cpCtx.prev !== null) session.pickedColor = cpCtx.prev; // 恢复打开前颜色
    $("customColorRow").hidden = true;
    updateColorUI();
  };
  $("f_name").addEventListener("input", () => {
    if (session.pickedColor === -1) updateColorUI(); // 自动配色随课程名实时变
  });
  $("btnCancelCourse").onclick = () => closeModal("courseModal");

  $("btnEditCourse").onclick = () => {
    if (session.courseModalMode === "view") {
      const c = findCourse(session.editingCourseId);
      if (c) openCourseModal("edit", c);
    } else {
      saveCourseFromForm();
    }
  };
  $("btnDeleteCourse").onclick = onDeleteClick;
  $("delCancel").onclick = () => closeModal("deleteModal");
  $("delOptions").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-del]");
    if (b) execDelete(b.dataset.del);
  });
  bindSlotListEvents();

  $("btnAddSlot").onclick = () => {
    const box = $("slotList");
    const last = box.lastElementChild;
    const sl = last ? readSlotFromCard(last) : M.normalizeSlot({});
    if (sl.err) {
      $("formTip").textContent = sl.err;
      return;
    }
    box.appendChild(slotCard(sl.slot || sl, box.children.length));
    renumberSlots();
    box.lastElementChild.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  };

  $("btnSaveSettings").onclick = saveSettings;
  $("s_alpha").oninput = (e) =>
    ($("alphaVal").textContent = e.target.value + "%");
  $("s_saturation").oninput = (e) =>
    ($("satVal").textContent = e.target.value + "%");
  $("s_itemHeight").oninput = (e) =>
    ($("heightVal").textContent = e.target.value + "px");
  $("s_showColBg").onchange = (e) => {
    $("rowColBgDark").hidden = !e.target.checked;
    $("rowColBgAlpha").hidden = !e.target.checked;
  };
  $("s_colBgAlpha").oninput = (e) =>
    ($("colBgAlphaVal").textContent = e.target.value + "%");
  $("s_sameLen").onchange = (e) => {
    // 只切换结束时间可编辑状态，不重建表格——已同步的时间保留供修改
    $("s_lessonLen").disabled = !e.target.checked;
    $("btnApplyLen").disabled = !e.target.checked;
    document
      .querySelectorAll('#timeTable input[data-field="end"]')
      .forEach((inp) => {
        inp.disabled = e.target.checked;
      });
  };
  const syncSundayFirstRow = () => {
    $("rowSundayFirst").hidden = !$("s_showSunday").checked;
  };
  $("s_showSaturday").onchange = syncSundayFirstRow;
  $("s_showSunday").onchange = syncSundayFirstRow;
  $("s_showOtherWeek").onchange = (e) => {
    $("rowOtherWeekAlpha").hidden = !e.target.checked;
  };
  $("s_owAlpha").oninput = (e) =>
    ($("owAlphaVal").textContent = e.target.value + "%");
  $("s_headerFs").oninput = (e) =>
    ($("headerFsVal").textContent = e.target.value + "px");
  $("s_textFs").oninput = (e) =>
    ($("textFsVal").textContent = e.target.value + "px");
  $("s_radius").oninput = (e) =>
    ($("radiusVal").textContent = e.target.value + "px");
  $("s_courseGap").oninput = (e) =>
    ($("courseGapVal").textContent = e.target.value + "%");
  $("btnApplyLen").onclick = () => {
    const len = Number($("s_lessonLen").value) || 45;
    document.querySelectorAll("#timeTable .time-row").forEach((row) => {
      const startInp = row.querySelector('input[data-field="start"]');
      const endInp = row.querySelector('input[data-field="end"]');
      if (startInp && startInp.value)
        endInp.value = addMinutes(startInp.value, len);
    });
    showToast("已按统一时长更新全部下课时间");
  };

  // 关闭弹窗
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll(".modal-overlay").forEach((ov) => {
    ov.addEventListener("mousedown", (e) => {
      if (e.target === ov) ov.hidden = true;
    });
  });

  // 键盘：← → 切周，Home 回本周，N 新增
  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(
      document.activeElement.tagName,
    );
    if (typing) return;
    const anyModal = document.querySelector(".modal-overlay:not([hidden])");
    if (anyModal) {
      if (e.key === "Escape")
        document
          .querySelectorAll(".modal-overlay")
          .forEach((m) => (m.hidden = true));
      return;
    }
    if (e.key === "ArrowLeft") setViewWeek(session.viewWeek - 1);
    else if (e.key === "ArrowRight") setViewWeek(session.viewWeek + 1);
    else if (e.key === "Home") setViewWeek(Math.max(1, calcCurrentWeek()));
    else if (e.key === "n" || e.key === "N") openCourseModal("add", null, null);
  });

  // 触摸板横向滑动切周
  $("scheduleWrap").addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) {
        e.preventDefault();
        setViewWeek(session.viewWeek + (e.deltaX > 0 ? 1 : -1));
      }
    },
    { passive: false },
  );

  // 时间表编辑：统一时长模式下改上课时间自动算下课时间；
  // 自定义模式下下课早于上课则自动对齐到上课时间（不报错）
  $("timeTable").addEventListener("change", (e) => {
    const inp = e.target;
    if (inp.tagName !== "INPUT" || !inp.dataset.ti) return;
    const row = inp.closest(".time-row");
    const endInp = row?.querySelector('input[data-field="end"]');
    if (!endInp || !inp.value) return;
    if (inp.dataset.field === "start") {
      if ($("s_sameLen").checked) {
        const len = Number($("s_lessonLen").value) || 45;
        endInp.value = addMinutes(inp.value, len);
      } else if (endInp.value && endInp.value < inp.value) {
        endInp.value = inp.value;
      }
    }
  });

  bindScheduleManager();
}

export { bindEvents };
