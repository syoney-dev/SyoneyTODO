(() => {
  "use strict";

  const STORAGE_KEY = "syoneytodo-data-v1";

  /** @typedef {{id:string,name:string,detail:string,dateFrom:string,dateTo:string,done:boolean}} Task */
  /** @typedef {{id:string,name:string,tasks:Task[]}} TodoList */

  /** @type {{lists: TodoList[], activeListId: string|null}} */
  let state = loadState();

  // ---------- Persistence ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.lists)) return parsed;
      }
    } catch (e) {
      console.error("読み込みに失敗しました", e);
    }
    // 初回起動時のサンプルデータ
    const sampleListId = uid();
    return {
      lists: [
        {
          id: sampleListId,
          name: "今日の予定",
          tasks: [
            {
              id: uid(),
              name: "SyoneyTODOへようこそ",
              detail: "チェックを入れると完了になります。タスクをタップすると詳細を編集できます。",
              dateFrom: "",
              dateTo: "",
              done: false,
            },
          ],
        },
      ],
      activeListId: sampleListId,
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("保存に失敗しました", e);
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ---------- DOM refs ----------

  const listTabsEl = document.getElementById("listTabs");
  const currentListNameEl = document.getElementById("currentListName");
  const taskCountEl = document.getElementById("taskCount");
  const taskListEl = document.getElementById("taskList");
  const emptyStateEl = document.getElementById("emptyState");

  const newListBtn = document.getElementById("newListBtn");
  const renameListBtn = document.getElementById("renameListBtn");
  const deleteListBtn = document.getElementById("deleteListBtn");
  const addTaskBtn = document.getElementById("addTaskBtn");

  const sheetOverlay = document.getElementById("sheetOverlay");
  const sheetTitle = document.getElementById("sheetTitle");
  const taskForm = document.getElementById("taskForm");
  const taskNameInput = document.getElementById("taskName");
  const taskDetailInput = document.getElementById("taskDetail");
  const taskFromInput = document.getElementById("taskFrom");
  const taskToInput = document.getElementById("taskTo");
  const taskDoneInput = document.getElementById("taskDone");
  const deleteTaskBtn = document.getElementById("deleteTaskBtn");
  const closeSheetBtn = document.getElementById("closeSheetBtn");
  const cancelTaskBtn = document.getElementById("cancelTaskBtn");

  let editingTaskId = null; // null = 新規作成

  // ---------- Helpers ----------

  function getActiveList() {
    return state.lists.find((l) => l.id === state.activeListId) || null;
  }

  function ensureActiveList() {
    if (!state.lists.length) {
      state.activeListId = null;
      return;
    }
    if (!getActiveList()) {
      state.activeListId = state.lists[0].id;
    }
  }

  function formatDateLabel(d) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${m}/${day}`;
  }

  function todayStr() {
    const t = new Date();
    return t.toISOString().slice(0, 10);
  }

  // ---------- Rendering ----------

  function render() {
    ensureActiveList();
    renderTabs();
    renderLedger();
  }

  function renderTabs() {
    listTabsEl.innerHTML = "";
    if (!state.lists.length) {
      const p = document.createElement("span");
      p.className = "list-tab-empty";
      p.textContent = "「＋」でリストを作成してください";
      listTabsEl.appendChild(p);
      return;
    }
    state.lists.forEach((list) => {
      const btn = document.createElement("button");
      btn.className = "list-tab" + (list.id === state.activeListId ? " active" : "");
      btn.textContent = list.name;
      btn.addEventListener("click", () => {
        state.activeListId = list.id;
        saveState();
        render();
      });
      listTabsEl.appendChild(btn);
    });
  }

  function renderLedger() {
    const list = getActiveList();

    if (!list) {
      currentListNameEl.textContent = "リストがありません";
      taskCountEl.textContent = "";
      taskListEl.innerHTML = "";
      emptyStateEl.hidden = true;
      renameListBtn.hidden = true;
      deleteListBtn.hidden = true;
      addTaskBtn.hidden = true;
      return;
    }

    renameListBtn.hidden = false;
    deleteListBtn.hidden = false;
    addTaskBtn.hidden = false;

    currentListNameEl.textContent = list.name;
    const doneCount = list.tasks.filter((t) => t.done).length;
    taskCountEl.textContent = list.tasks.length
      ? `${doneCount}/${list.tasks.length} 完了`
      : "";

    taskListEl.innerHTML = "";
    emptyStateEl.hidden = list.tasks.length !== 0;

    const today = todayStr();

    list.tasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = "task-row" + (task.done ? " done" : "");

      const check = document.createElement("button");
      check.type = "button";
      check.className = "task-check";
      check.setAttribute("aria-label", "完了を切り替える");
      check.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.2 11.7L13 4.5" stroke="#161D27" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        task.done = !task.done;
        saveState();
        renderLedger();
      });

      const body = document.createElement("div");
      body.className = "task-body";

      const name = document.createElement("div");
      name.className = "task-name";
      name.textContent = task.name;
      body.appendChild(name);

      if (task.detail) {
        const detail = document.createElement("div");
        detail.className = "task-detail";
        detail.textContent = task.detail;
        body.appendChild(detail);
      }

      if (task.dateFrom || task.dateTo) {
        const dates = document.createElement("div");
        const overdue = !task.done && task.dateTo && task.dateTo < today;
        dates.className = "task-dates" + (overdue ? " overdue" : "");
        if (task.dateFrom && task.dateTo) {
          dates.textContent = `${formatDateLabel(task.dateFrom)} → ${formatDateLabel(task.dateTo)}`;
        } else if (task.dateTo) {
          dates.textContent = `期限 ${formatDateLabel(task.dateTo)}`;
        } else {
          dates.textContent = `開始 ${formatDateLabel(task.dateFrom)}`;
        }
        body.appendChild(dates);
      }

      li.appendChild(check);
      li.appendChild(body);
      li.addEventListener("click", () => openTaskSheet(task.id));

      taskListEl.appendChild(li);
    });
  }

  // ---------- List actions ----------

  newListBtn.addEventListener("click", () => {
    const name = prompt("新しいリストの名前を入力してください");
    if (!name || !name.trim()) return;
    const list = { id: uid(), name: name.trim(), tasks: [] };
    state.lists.push(list);
    state.activeListId = list.id;
    saveState();
    render();
  });

  renameListBtn.addEventListener("click", () => {
    const list = getActiveList();
    if (!list) return;
    const name = prompt("リスト名を変更", list.name);
    if (!name || !name.trim()) return;
    list.name = name.trim();
    saveState();
    render();
  });

  deleteListBtn.addEventListener("click", () => {
    const list = getActiveList();
    if (!list) return;
    if (!confirm(`「${list.name}」を削除しますか?中のタスクも全て削除されます。`)) return;
    state.lists = state.lists.filter((l) => l.id !== list.id);
    state.activeListId = state.lists.length ? state.lists[0].id : null;
    saveState();
    render();
  });

  // ---------- Task sheet ----------

  function openTaskSheet(taskId) {
    const list = getActiveList();
    if (!list) return;
    editingTaskId = taskId;

    if (taskId) {
      const task = list.tasks.find((t) => t.id === taskId);
      if (!task) return;
      sheetTitle.textContent = "タスクを編集";
      taskNameInput.value = task.name;
      taskDetailInput.value = task.detail || "";
      taskFromInput.value = task.dateFrom || "";
      taskToInput.value = task.dateTo || "";
      taskDoneInput.checked = task.done;
      deleteTaskBtn.hidden = false;
    } else {
      sheetTitle.textContent = "タスクを追加";
      taskForm.reset();
      deleteTaskBtn.hidden = true;
    }

    sheetOverlay.hidden = false;
    setTimeout(() => taskNameInput.focus(), 50);
  }

  function closeSheet() {
    sheetOverlay.hidden = true;
    editingTaskId = null;
    taskForm.reset();
  }

  addTaskBtn.addEventListener("click", () => openTaskSheet(null));
  closeSheetBtn.addEventListener("click", closeSheet);
  cancelTaskBtn.addEventListener("click", closeSheet);
  sheetOverlay.addEventListener("click", (e) => {
    if (e.target === sheetOverlay) closeSheet();
  });

  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const list = getActiveList();
    if (!list) return;

    const name = taskNameInput.value.trim();
    if (!name) return;

    let dateFrom = taskFromInput.value;
    let dateTo = taskToInput.value;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      [dateFrom, dateTo] = [dateTo, dateFrom];
    }

    if (editingTaskId) {
      const task = list.tasks.find((t) => t.id === editingTaskId);
      if (task) {
        task.name = name;
        task.detail = taskDetailInput.value.trim();
        task.dateFrom = dateFrom;
        task.dateTo = dateTo;
        task.done = taskDoneInput.checked;
      }
    } else {
      list.tasks.push({
        id: uid(),
        name,
        detail: taskDetailInput.value.trim(),
        dateFrom,
        dateTo,
        done: taskDoneInput.checked,
      });
    }

    saveState();
    closeSheet();
    renderLedger();
  });

  deleteTaskBtn.addEventListener("click", () => {
    const list = getActiveList();
    if (!list || !editingTaskId) return;
    if (!confirm("このタスクを削除しますか?")) return;
    list.tasks = list.tasks.filter((t) => t.id !== editingTaskId);
    saveState();
    closeSheet();
    renderLedger();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheetOverlay.hidden) closeSheet();
  });

  // ---------- Service worker ----------

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => {
        console.warn("Service worker registration failed", e);
      });
    });
  }

  // ---------- Init ----------

  render();
})();
