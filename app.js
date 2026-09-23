import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ---------- Firebase ----------

// Web 用の接続情報は公開前提の値。アクセス制御は firestore.rules で行う。
const firebaseConfig = {
  apiKey: "AIzaSyBWrLYTiKPo5u6lR05iNYPS0HwxGCa2XIg",
  authDomain: "syoneytodo.firebaseapp.com",
  projectId: "syoneytodo",
  storageBucket: "syoneytodo.firebasestorage.app",
  messagingSenderId: "154744024215",
  appId: "1:154744024215:web:de059ef590f5b80e3b4dd2",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const listDoc = (listId) => doc(db, "lists", listId);
const tasksCol = (listId) => collection(db, "lists", listId, "tasks");
const taskDoc = (listId, taskId) => doc(db, "lists", listId, "tasks", taskId);
// 推測されにくい ID(Firestore の自動 ID と同じ 20 文字)
const newListId = () => doc(collection(db, "lists")).id;
const newTaskId = (listId) => doc(tasksCol(listId)).id;

// ---------- Local registry ----------
// この端末で開いているリストの ID と、選択中のリストだけを localStorage に持つ。
// リスト名・タスクの中身は Firestore が正。

const REGISTRY_KEY = "syoneytodo-registry-v2";
const LEGACY_KEY = "syoneytodo-data-v1";
const MIGRATED_KEY = "syoneytodo-migrated-v2";

/** @typedef {{id:string,name:string,detail:string,dateFrom:string,dateTo:string,done:boolean,createdAt:number}} Task */

/** @type {{listIds: string[], activeListId: string|null}} */
const registry = loadRegistry();

/** @type {Map<string, {name:string}|null>} null = 読み込み中 */
const listMeta = new Map();
/** @type {Map<string, Task[]>} */
const tasksByList = new Map();
/** @type {Map<string, () => void>} */
const unsubscribers = new Map();

let ready = false; // 認証と初期化が終わったか
let fatalError = "";

function loadRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.listIds)) return parsed;
    }
  } catch (e) {
    console.error("読み込みに失敗しました", e);
  }
  return { listIds: [], activeListId: null };
}

function saveRegistry() {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch (e) {
    console.error("保存に失敗しました", e);
  }
}

function addToRegistry(listId, makeActive) {
  if (!registry.listIds.includes(listId)) registry.listIds.push(listId);
  if (makeActive) registry.activeListId = listId;
  saveRegistry();
  subscribeList(listId);
}

function removeFromRegistry(listId) {
  registry.listIds = registry.listIds.filter((id) => id !== listId);
  if (registry.activeListId === listId) registry.activeListId = registry.listIds[0] || null;
  saveRegistry();
  const unsub = unsubscribers.get(listId);
  if (unsub) unsub();
  unsubscribers.delete(listId);
  listMeta.delete(listId);
  tasksByList.delete(listId);
}

// ---------- Firestore sync ----------

function subscribeList(listId) {
  if (unsubscribers.has(listId)) return;
  listMeta.set(listId, null);
  tasksByList.set(listId, []);

  const unsubMeta = onSnapshot(
    listDoc(listId),
    (snap) => {
      if (snap.exists()) {
        listMeta.set(listId, { name: snap.data().name });
      } else if (!snap.metadata.fromCache) {
        // サーバー上に無い = 他の人が削除した、またはリンクが間違っている
        const wasKnown = listMeta.get(listId) != null;
        removeFromRegistry(listId);
        alert(wasKnown ? "共有リストが削除されました。" : "リストが見つかりませんでした。リンクを確認してください。");
      }
      render();
    },
    (err) => reportReadError(err)
  );

  const unsubTasks = onSnapshot(
    query(tasksCol(listId), orderBy("createdAt")),
    (snap) => {
      tasksByList.set(listId, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (listId === registry.activeListId) renderLedger();
    },
    (err) => reportReadError(err)
  );

  unsubscribers.set(listId, () => {
    unsubMeta();
    unsubTasks();
  });
}

// 書き込みはオフラインでも即座に画面へ反映され、サーバーへの送信は後から行われる。
// そのため完了を待たず、失敗したときだけ知らせる。
function write(promise) {
  promise.catch((err) => reportError("保存に失敗しました", err));
}

// 読み込みエラーはリストごとに何度も起きうるので、アラートではなく画面上部に表示する
function reportReadError(err) {
  console.error("読み込みに失敗しました", err);
  fatalError =
    err && err.code === "permission-denied"
      ? "データを読み込む権限がありません。Firestore のセキュリティルールを確認してください。"
      : "データの読み込みに失敗しました。再読み込みしてください。";
  renderLedger();
}

function reportError(message, err) {
  console.error(message, err);
  if (err && err.code === "permission-denied") {
    alert(`${message}(権限がないか、リストが他の人に削除されています)`);
  } else if (err && err.code === "not-found") {
    alert(`${message}(他の人が先に削除した可能性があります)`);
  } else {
    alert(`${message}: ${err && err.message ? err.message : err}`);
  }
}

function createList(name, tasks = []) {
  const listId = newListId();
  const batch = writeBatch(db);
  const now = Date.now();
  batch.set(listDoc(listId), { name, createdAt: now });
  tasks.forEach((t, i) => {
    batch.set(taskDoc(listId, newTaskId(listId)), {
      name: t.name || "",
      detail: t.detail || "",
      dateFrom: t.dateFrom || "",
      dateTo: t.dateTo || "",
      done: !!t.done,
      createdAt: now + i,
    });
  });
  write(batch.commit());
  return listId;
}

// v1(localStorage だけに保存していた頃)のデータを一度だけ Firestore へ移す。
// 元データはバックアップとして残す。
function migrateLegacyData() {
  if (localStorage.getItem(MIGRATED_KEY)) return;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const legacy = raw ? JSON.parse(raw) : null;
    if (legacy && Array.isArray(legacy.lists)) {
      legacy.lists.forEach((l) => {
        const listId = createList(l.name || "無題のリスト", l.tasks || []);
        addToRegistry(listId, l.id === legacy.activeListId);
      });
    }
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch (e) {
    console.error("移行に失敗しました", e);
  }
}

// ---------- Share links ----------
// 共有 URL: .../index.html#list=<リストID>

function shareUrlFor(listId) {
  return `${location.origin}${location.pathname}#list=${listId}`;
}

function consumeShareHash() {
  const m = location.hash.match(/^#list=([A-Za-z0-9]{20})$/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search);
  addToRegistry(m[1], true);
  return true;
}

// ---------- DOM refs ----------

const listTabsEl = document.getElementById("listTabs");
const currentListNameEl = document.getElementById("currentListName");
const taskCountEl = document.getElementById("taskCount");
const taskListEl = document.getElementById("taskList");
const emptyStateEl = document.getElementById("emptyState");
const statusMsgEl = document.getElementById("statusMsg");

const newListBtn = document.getElementById("newListBtn");
const shareListBtn = document.getElementById("shareListBtn");
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

function getActiveListId() {
  if (!registry.listIds.length) return null;
  if (!registry.listIds.includes(registry.activeListId)) {
    registry.activeListId = registry.listIds[0];
  }
  return registry.activeListId;
}

function getActiveTasks() {
  const id = getActiveListId();
  return (id && tasksByList.get(id)) || [];
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
  renderTabs();
  renderLedger();
}

function renderTabs() {
  listTabsEl.innerHTML = "";
  if (!ready) return;
  if (!registry.listIds.length) {
    const p = document.createElement("span");
    p.className = "list-tab-empty";
    p.textContent = "「＋」でリストを作成してください";
    listTabsEl.appendChild(p);
    return;
  }
  const activeId = getActiveListId();
  registry.listIds.forEach((listId) => {
    const meta = listMeta.get(listId);
    const btn = document.createElement("button");
    btn.className = "list-tab" + (listId === activeId ? " active" : "");
    btn.textContent = meta ? meta.name : "読み込み中…";
    btn.addEventListener("click", () => {
      registry.activeListId = listId;
      saveRegistry();
      render();
    });
    listTabsEl.appendChild(btn);
  });
}

function setListActionsHidden(hidden) {
  shareListBtn.hidden = hidden;
  renameListBtn.hidden = hidden;
  deleteListBtn.hidden = hidden;
  addTaskBtn.hidden = hidden;
}

function renderLedger() {
  const listId = getActiveListId();
  const meta = listId ? listMeta.get(listId) : undefined;

  statusMsgEl.hidden = !(fatalError || !ready);
  statusMsgEl.textContent = fatalError || "接続中…";

  if (!ready || !listId || !meta) {
    currentListNameEl.textContent = !ready || (listId && !meta) ? "読み込み中…" : "リストがありません";
    taskCountEl.textContent = "";
    taskListEl.innerHTML = "";
    emptyStateEl.hidden = true;
    setListActionsHidden(true);
    return;
  }

  setListActionsHidden(false);

  const tasks = getActiveTasks();
  currentListNameEl.textContent = meta.name;
  const doneCount = tasks.filter((t) => t.done).length;
  taskCountEl.textContent = tasks.length ? `${doneCount}/${tasks.length} 完了` : "";

  taskListEl.innerHTML = "";
  emptyStateEl.hidden = tasks.length !== 0;

  const today = todayStr();

  tasks.forEach((task) => {
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
      write(updateDoc(taskDoc(listId, task.id), { done: !task.done }));
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
  if (!ready) return;
  const name = prompt("新しいリストの名前を入力してください");
  if (!name || !name.trim()) return;
  const listId = createList(name.trim());
  addToRegistry(listId, true);
  render();
});

shareListBtn.addEventListener("click", async () => {
  const listId = getActiveListId();
  const meta = listId && listMeta.get(listId);
  if (!meta) return;
  const url = shareUrlFor(listId);
  if (navigator.share) {
    try {
      await navigator.share({ title: `SyoneyTODO「${meta.name}」`, url });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    alert("共有用のURLをコピーしました。このURLを開いた人は、このリストを閲覧・編集できます。");
  } catch (e) {
    prompt("このURLを共有してください。開いた人はこのリストを閲覧・編集できます。", url);
  }
});

renameListBtn.addEventListener("click", () => {
  const listId = getActiveListId();
  const meta = listId && listMeta.get(listId);
  if (!meta) return;
  const name = prompt("リスト名を変更", meta.name);
  if (!name || !name.trim()) return;
  write(updateDoc(listDoc(listId), { name: name.trim() }));
});

deleteListBtn.addEventListener("click", () => {
  const listId = getActiveListId();
  const meta = listId && listMeta.get(listId);
  if (!meta) return;
  if (!confirm(`「${meta.name}」を削除しますか?中のタスクも全て削除され、共有している全員の画面からも消えます。`)) return;
  const batch = writeBatch(db);
  (tasksByList.get(listId) || []).forEach((t) => batch.delete(taskDoc(listId, t.id)));
  batch.delete(listDoc(listId));
  removeFromRegistry(listId);
  write(batch.commit());
  render();
});

// ---------- Task sheet ----------

function openTaskSheet(taskId) {
  if (!getActiveListId()) return;
  editingTaskId = taskId;

  if (taskId) {
    const task = getActiveTasks().find((t) => t.id === taskId);
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
  const listId = getActiveListId();
  if (!listId) return;

  const name = taskNameInput.value.trim();
  if (!name) return;

  let dateFrom = taskFromInput.value;
  let dateTo = taskToInput.value;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  const fields = {
    name,
    detail: taskDetailInput.value.trim(),
    dateFrom,
    dateTo,
    done: taskDoneInput.checked,
  };

  if (editingTaskId) {
    // updateDoc は、他の人が先に削除していたら失敗する(勝手に復活させない)
    write(updateDoc(taskDoc(listId, editingTaskId), fields));
  } else {
    write(setDoc(taskDoc(listId, newTaskId(listId)), { ...fields, createdAt: Date.now() }));
  }

  closeSheet();
});

deleteTaskBtn.addEventListener("click", () => {
  const listId = getActiveListId();
  if (!listId || !editingTaskId) return;
  if (!confirm("このタスクを削除しますか?")) return;
  write(deleteDoc(taskDoc(listId, editingTaskId)));
  closeSheet();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sheetOverlay.hidden) closeSheet();
});

window.addEventListener("hashchange", () => {
  if (ready && consumeShareHash()) render();
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

async function init() {
  // 利用者には見えない匿名ログイン。一度ログインすると端末に保持される。
  await new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) {
        stop();
        resolve();
      } else {
        signInAnonymously(auth).catch((err) => {
          stop();
          reject(err);
        });
      }
    });
  });

  registry.listIds.forEach(subscribeList);
  const openedFromLink = consumeShareHash();
  migrateLegacyData();

  if (!registry.listIds.length && !openedFromLink) {
    const listId = createList("今日の予定", [
      {
        name: "SyoneyTODOへようこそ",
        detail: "チェックを入れると完了になります。タスクをタップすると詳細を編集できます。「共有」から他の人と一緒に編集できます。",
      },
    ]);
    addToRegistry(listId, true);
  }

  ready = true;
  render();
}

render();
init().catch((err) => {
  console.error(err);
  fatalError =
    err && err.code === "auth/operation-not-allowed"
      ? "Firebase で匿名ログインが有効になっていません。"
      : "サーバーに接続できませんでした。通信環境を確認して、再読み込みしてください。";
  render();
});
