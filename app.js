import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  query,
  orderBy,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/*
  1. 到 Firebase console 建立 Web App
  2. 把下面 firebaseConfig 改成你的專案設定
*/
const firebaseConfig = {
  apiKey: "AIzaSyAQ08YZt8yzzYHyV9fiYnQ5Q2l7yTiQJVw",
  authDomain: "diary-log-2f902.firebaseapp.com",
  projectId: "diary-log-2f902",
  storageBucket: "diary-log-2f902.firebasestorage.app",
  messagingSenderId: "910291009679",
  appId: "1:910291009679:web:8eaf0339f5a67180d830fa"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const userLabel = document.getElementById("userLabel");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const entryCard = document.getElementById("entryCard");
const timelinesCard = document.getElementById("timelinesCard");
const eventForm = document.getElementById("eventForm");
const eventNameInput = document.getElementById("eventName");
const eventDescriptionInput = document.getElementById("eventDescription");
const eventTimeInput = document.getElementById("eventTime");
const eventNameSuggestions = document.getElementById("eventNameSuggestions");
const refreshBtn = document.getElementById("refreshBtn");
const timelinesContainer = document.getElementById("timelines");
const emptyMessage = document.getElementById("emptyMessage");
const openaiKeyStatusBtn = document.getElementById("openaiKeyStatus");
const apiKeyDialog = document.getElementById("apiKeyDialog");
const apiKeyForm = document.getElementById("apiKeyForm");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveApiKeyCheckbox = document.getElementById("saveApiKeyCheckbox");
const cancelApiKeyBtn = document.getElementById("cancelApiKeyBtn");

let currentUser = null;
const timelineOpenState = new Map();
const timelineEditModeState = new Map();
const editingEventState = new Set();
const generatingBackgroundState = new Set();
const OPENAI_KEY_STORAGE_KEY = "dailyLogOpenAIKey";
let timelineBackgrounds = {};

function toMillis(ts) {
  if (!ts || typeof ts.toMillis !== "function") return 0;
  return ts.toMillis();
}

function setDefaultDatetimeLocal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  eventTimeInput.value = local;
}

function formatTimestamp(ts) {
  if (!ts) return "未提供時間";
  const date = ts.toDate();
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDatetimeLocal(ts) {
  const date = ts?.toDate?.();
  if (!date) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function getBackgroundStorageKey(uid) {
  return `dailyLogTimelineBackgrounds:${uid}`;
}

function getBackgroundDocRef(uid) {
  return doc(db, "users", uid, "settings", "timelineBackgrounds");
}

function getSavedOpenAIKey() {
  return localStorage.getItem(OPENAI_KEY_STORAGE_KEY) ?? "";
}

function saveOpenAIKey(key) {
  localStorage.setItem(OPENAI_KEY_STORAGE_KEY, key);
  updateOpenAIKeyStatus();
}

function removeOpenAIKey() {
  localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
  updateOpenAIKeyStatus();
}

function updateOpenAIKeyStatus() {
  if (!openaiKeyStatusBtn) return;
  const hasKey = Boolean(getSavedOpenAIKey());
  openaiKeyStatusBtn.classList.toggle("hidden", !hasKey);
}

function readLocalTimelineBackgrounds(uid) {
  const scopedRaw = localStorage.getItem(getBackgroundStorageKey(uid));
  const legacyRaw = localStorage.getItem("dailyLogTimelineBackgrounds");
  const raw = scopedRaw ?? legacyRaw;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toBackgroundMapFromEntries(entries) {
  const result = {};
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const imageUrl = typeof entry?.imageUrl === "string" ? entry.imageUrl : "";
    if (!name || !imageUrl) continue;
    result[name] = imageUrl;
  }
  return result;
}

function toBackgroundEntries(map) {
  return Object.entries(map)
    .filter(([name, imageUrl]) => Boolean(name) && typeof imageUrl === "string" && imageUrl.length > 0)
    .map(([name, imageUrl]) => ({ name, imageUrl }));
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("背景圖處理失敗"));
    img.src = dataUrl;
  });
}

async function optimizeImageForFirestore(imageUrl) {
  if (!imageUrl.startsWith("data:image/")) return imageUrl;
  if (imageUrl.length < 280000) return imageUrl;

  const img = await loadImageFromDataUrl(imageUrl);
  const maxWidth = 896;
  const maxHeight = 600;
  const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.76);
}

async function loadTimelineBackgrounds() {
  if (!currentUser) return;
  const uid = currentUser.uid;
  const docRef = getBackgroundDocRef(uid);
  const localBackgrounds = readLocalTimelineBackgrounds(uid);

  let remoteBackgrounds = {};
  let snap = null;
  let needRepair = false;
  try {
    snap = await getDoc(docRef);
  } catch (error) {
    const message = String(error?.message ?? "");
    if (/Property backgrounds contains an invalid nested entity/i.test(message)) {
      needRepair = true;
    } else {
      throw error;
    }
  }

  if (needRepair) {
    // Corrupted doc: rebuild directly without reading old fields again.
    const repaired = { ...localBackgrounds };
    await setDoc(docRef, {
      entries: toBackgroundEntries(repaired),
      updatedAt: Timestamp.now(),
    });
    localStorage.removeItem(getBackgroundStorageKey(uid));
    localStorage.removeItem("dailyLogTimelineBackgrounds");
    timelineBackgrounds = repaired;
    return;
  }

  if (snap?.exists()) {
    const data = snap.data();
    remoteBackgrounds = {
      ...(data?.backgrounds && typeof data.backgrounds === "object" ? data.backgrounds : {}),
      ...toBackgroundMapFromEntries(data?.entries),
    };
  }

  // Migrate existing local backgrounds to Firestore once, then clear local copy.
  if (Object.keys(localBackgrounds).length) {
    const merged = { ...remoteBackgrounds, ...localBackgrounds };
    await setDoc(
      docRef,
      { entries: JSON.stringify(toBackgroundEntries(merged)), updatedAt: Timestamp.now() }
    );
    localStorage.removeItem(getBackgroundStorageKey(uid));
    localStorage.removeItem("dailyLogTimelineBackgrounds");
    timelineBackgrounds = merged;
    return;
  }

  timelineBackgrounds = remoteBackgrounds;
}

async function persistTimelineBackgrounds() {
  if (!currentUser) return;
  const entries = toBackgroundEntries(timelineBackgrounds);
  const totalSize = JSON.stringify(entries).length;
  if (totalSize > 850000) {
    throw new Error("背景圖資料過大，請減少背景圖數量或重新產生。");
  }
  await setDoc(
    getBackgroundDocRef(currentUser.uid),
    { entries, updatedAt: Timestamp.now() }
  );
}

function buildCategoryBackgroundPrompt(categoryName) {
  return [
    "Create a clean editorial illustration background for a personal timeline card.",
    `Theme category: "${categoryName}".`,
    "Style: warm, hand-drawn digital illustration, soft texture, modern flat illustration.",
    "Composition: leave enough calm negative space for text overlays in the center-left area.",
    "Color: gentle natural palette, low contrast, readable under a light translucent overlay.",
    "Content: symbolic objects/scenes that fit the category theme, no people faces required.",
    "Hard rules: no words, no letters, no logos, no watermark, no signature, no UI elements.",
    "Mood: practical daily life, cozy, organized, slightly playful.",
  ].join(" ");
}

async function requestTimelineBackgroundImage(categoryName, apiKey) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: buildCategoryBackgroundPrompt(categoryName),
      size: "1536x1024",
      quality: "medium",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API 錯誤 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const image = data?.data?.[0];
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  if (image?.url) return image.url;
  throw new Error("OpenAI 沒有回傳可用圖片");
}

async function askForOpenAIKey() {
  const saved = getSavedOpenAIKey();
  if (saved) return saved;
  if (!apiKeyDialog || !apiKeyForm || !apiKeyInput || !saveApiKeyCheckbox) return "";

  apiKeyInput.value = "";
  saveApiKeyCheckbox.checked = false;
  apiKeyDialog.showModal();

  return await new Promise((resolve) => {
    const closeWith = (value) => {
      apiKeyForm.removeEventListener("submit", onSubmit);
      cancelApiKeyBtn?.removeEventListener("click", onCancel);
      apiKeyDialog.removeEventListener("cancel", onCancel);
      if (apiKeyDialog.open) apiKeyDialog.close();
      resolve(value);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      const key = apiKeyInput.value.trim();
      if (!key) return;
      if (saveApiKeyCheckbox.checked) saveOpenAIKey(key);
      closeWith(key);
    };

    const onCancel = () => closeWith("");

    apiKeyForm.addEventListener("submit", onSubmit);
    cancelApiKeyBtn?.addEventListener("click", onCancel);
    apiKeyDialog.addEventListener("cancel", onCancel);
  });
}

function groupByName(events) {
  const grouped = new Map();
  for (const e of events) {
    if (!grouped.has(e.name)) grouped.set(e.name, []);
    grouped.get(e.name).push(e);
  }

  for (const [_, items] of grouped) {
    items.sort((a, b) => toMillis(b.occurredAt) - toMillis(a.occurredAt));
  }

  return [...grouped.entries()].sort((a, b) => {
    const latestA = toMillis(a[1][0]?.occurredAt);
    const latestB = toMillis(b[1][0]?.occurredAt);
    return latestB - latestA;
  });
}

function renderEventNameSuggestions(events) {
  if (!eventNameSuggestions) return;

  const uniqueNames = [...new Set(events.map((e) => e.name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant")
  );

  eventNameSuggestions.innerHTML = "";
  for (const name of uniqueNames) {
    const option = document.createElement("option");
    option.value = name;
    eventNameSuggestions.appendChild(option);
  }
}

function renderTimelines(events) {
  timelinesContainer.innerHTML = "";

  if (!events.length) {
    emptyMessage.classList.remove("hidden");
    return;
  }

  emptyMessage.classList.add("hidden");

  const grouped = groupByName(events);

  const visibleNames = new Set(grouped.map(([name]) => name));
  for (const key of [...timelineOpenState.keys()]) {
    if (!visibleNames.has(key)) timelineOpenState.delete(key);
  }
  for (const key of [...timelineEditModeState.keys()]) {
    if (!visibleNames.has(key)) timelineEditModeState.delete(key);
  }

  const visibleIds = new Set(events.map((e) => e.id));
  for (const eventId of [...editingEventState]) {
    if (!visibleIds.has(eventId)) editingEventState.delete(eventId);
  }

  for (const [index, [name, items]] of grouped.entries()) {
    if (!timelineOpenState.has(name)) {
      const shouldOpen = index === 0;
      timelineOpenState.set(name, shouldOpen);
    }
    if (!timelineEditModeState.has(name)) {
      timelineEditModeState.set(name, false);
    }

    const timeline = document.createElement("section");
    timeline.className = "timeline";
    const backgroundImage = timelineBackgrounds[name];
    if (backgroundImage) {
      timeline.style.backgroundImage = `linear-gradient(rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0.84)), url("${backgroundImage}")`;
      timeline.style.backgroundSize = "cover";
      timeline.style.backgroundPosition = "center";
    } else {
      timeline.style.backgroundImage = "";
    }

    const headerRow = document.createElement("div");
    headerRow.className = "timeline-header-row";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "timeline-toggle";
    header.setAttribute("aria-expanded", String(timelineOpenState.get(name)));
    header.innerHTML = `<span>${name}（${items.length}）</span><span class="toggle-indicator">${
      timelineOpenState.get(name) ? "收合" : "展開"
    }</span>`;

    const editModeBtn = document.createElement("button");
    editModeBtn.type = "button";
    editModeBtn.className = `btn btn-secondary timeline-edit-mode-btn${
      timelineEditModeState.get(name) ? " is-active" : ""
    }`;
    editModeBtn.textContent = timelineEditModeState.get(name) ? "完成" : "編輯";

    const updateBgBtn = document.createElement("button");
    updateBgBtn.type = "button";
    updateBgBtn.className = "btn btn-secondary timeline-bg-btn";
    updateBgBtn.textContent = generatingBackgroundState.has(name) ? "產生中..." : "更新背景圖";
    updateBgBtn.disabled = generatingBackgroundState.has(name);

    const deleteCategoryBtn = document.createElement("button");
    deleteCategoryBtn.type = "button";
    deleteCategoryBtn.className = "btn btn-danger timeline-delete-category-btn";
    deleteCategoryBtn.textContent = "刪除類別";
    deleteCategoryBtn.disabled = generatingBackgroundState.has(name);

    if (!timelineEditModeState.get(name)) {
      updateBgBtn.classList.add("hidden");
      deleteCategoryBtn.classList.add("hidden");
    }

    headerRow.appendChild(header);
    headerRow.appendChild(editModeBtn);
    headerRow.appendChild(updateBgBtn);
    headerRow.appendChild(deleteCategoryBtn);
    timeline.appendChild(headerRow);

    const list = document.createElement("ul");
    list.className = "timeline-list";
    if (!timelineOpenState.get(name)) {
      list.classList.add("collapsed");
    }

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "timeline-item";

      const isEditing = editingEventState.has(item.id);
      const isEditMode = timelineEditModeState.get(name);

      if (isEditing) {
        const editForm = document.createElement("form");
        editForm.className = "inline-edit-form";

        const timeInput = document.createElement("input");
        timeInput.type = "datetime-local";
        timeInput.required = true;
        timeInput.value = formatDatetimeLocal(item.occurredAt);

        const descInput = document.createElement("textarea");
        descInput.rows = 3;
        descInput.maxLength = 500;
        descInput.required = true;
        descInput.value = item.description ?? "";

        const editActions = document.createElement("div");
        editActions.className = "inline-edit-actions";

        const saveBtn = document.createElement("button");
        saveBtn.type = "submit";
        saveBtn.className = "btn btn-primary";
        saveBtn.textContent = "儲存";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.textContent = "取消";

        cancelBtn.addEventListener("click", () => {
          editingEventState.delete(item.id);
          renderTimelines(events);
        });

        editForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const nextDescription = descInput.value.trim();
          const nextDatetime = timeInput.value;
          const nextDate = new Date(nextDatetime);

          if (!nextDescription || Number.isNaN(nextDate.getTime())) {
            alert("請輸入有效的描述與時間");
            return;
          }

          await updateDoc(doc(db, "users", currentUser.uid, "events", item.id), {
            description: nextDescription,
            occurredAt: Timestamp.fromDate(nextDate),
            updatedAt: Timestamp.now(),
          });

          editingEventState.delete(item.id);
          await loadEvents();
        });

        editActions.appendChild(saveBtn);
        editActions.appendChild(cancelBtn);
        editForm.appendChild(timeInput);
        editForm.appendChild(descInput);
        editForm.appendChild(editActions);
        li.appendChild(editForm);
      } else {
        const itemHead = document.createElement("div");
        itemHead.className = "timeline-item-head";

        const time = document.createElement("div");
        time.className = "item-time";
        time.textContent = formatTimestamp(item.occurredAt);

        itemHead.appendChild(time);

        if (isEditMode) {
          const itemActions = document.createElement("div");
          itemActions.className = "item-actions";

          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "icon-btn";
          editBtn.setAttribute("aria-label", "編輯事件");
          editBtn.title = "編輯";
          editBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm14.71-9.04a1 1 0 0 0 0-1.41l-2.5-2.5a1 1 0 0 0-1.41 0l-1.25 1.25 3.75 3.75 1.41-1.38z"/>
            </svg>`;

          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "icon-btn danger";
          deleteBtn.setAttribute("aria-label", "刪除事件");
          deleteBtn.title = "刪除";
          deleteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z"/>
            </svg>`;

          editBtn.addEventListener("click", () => {
            editingEventState.add(item.id);
            renderTimelines(events);
          });

          deleteBtn.addEventListener("click", async () => {
            const confirmed = window.confirm("確定要刪除這筆事件嗎？");
            if (!confirmed) return;
            await deleteDoc(doc(db, "users", currentUser.uid, "events", item.id));
            editingEventState.delete(item.id);
            await loadEvents();
          });

          itemActions.appendChild(editBtn);
          itemActions.appendChild(deleteBtn);
          itemHead.appendChild(itemActions);
        }

        const desc = document.createElement("p");
        desc.className = "item-desc";
        desc.textContent = item.description;

        li.appendChild(itemHead);
        li.appendChild(desc);
      }

      list.appendChild(li);
    }

    timeline.appendChild(list);

    header.addEventListener("click", () => {
      const isOpen = timelineOpenState.get(name) ?? false;
      const next = !isOpen;
      timelineOpenState.set(name, next);
      header.setAttribute("aria-expanded", String(next));
      header.innerHTML = `<span>${name}（${items.length}）</span><span class="toggle-indicator">${
        next ? "收合" : "展開"
      }</span>`;
      list.classList.toggle("collapsed", !next);
    });

    editModeBtn.addEventListener("click", () => {
      const next = !(timelineEditModeState.get(name) ?? false);
      timelineEditModeState.set(name, next);
      if (!next) {
        for (const item of items) editingEventState.delete(item.id);
      }
      renderTimelines(events);
    });

    updateBgBtn.addEventListener("click", async () => {
      if (generatingBackgroundState.has(name)) return;
      const apiKey = await askForOpenAIKey();
      if (!apiKey) return;

      try {
        generatingBackgroundState.add(name);
        renderTimelines(events);
        const imageUrl = await requestTimelineBackgroundImage(name, apiKey);
        const optimizedUrl = await optimizeImageForFirestore(imageUrl);
        timelineBackgrounds[name] = optimizedUrl;
        await persistTimelineBackgrounds();
      } catch (error) {
        alert(`更新背景圖失敗：${error.message}`);
      } finally {
        generatingBackgroundState.delete(name);
        renderTimelines(events);
      }
    });

    deleteCategoryBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(`確定要刪除「${name}」整個類別嗎？這會刪除該類別全部事件。`);
      if (!confirmed) return;

      try {
        const targetQuery = query(
          collection(db, "users", currentUser.uid, "events"),
          where("name", "==", name)
        );
        const targetSnapshot = await getDocs(targetQuery);
        await Promise.all(
          targetSnapshot.docs.map((eventDoc) =>
            deleteDoc(doc(db, "users", currentUser.uid, "events", eventDoc.id))
          )
        );

        if (timelineBackgrounds[name]) {
          delete timelineBackgrounds[name];
          await persistTimelineBackgrounds();
        }

        timelineOpenState.delete(name);
        timelineEditModeState.delete(name);
        for (const item of items) editingEventState.delete(item.id);
        await loadEvents();
      } catch (error) {
        alert(`刪除類別失敗：${error.message}`);
      }
    });

    timelinesContainer.appendChild(timeline);
  }
}

async function loadEvents() {
  if (!currentUser) return;

  const q = query(
    collection(db, "users", currentUser.uid, "events"),
    orderBy("occurredAt", "desc")
  );

  const snapshot = await getDocs(q);
  const events = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  events.sort((a, b) => toMillis(b.occurredAt) - toMillis(a.occurredAt));
  renderEventNameSuggestions(events);
  renderTimelines(events);
}

async function saveEvent(event) {
  event.preventDefault();
  if (!currentUser) return;

  const name = eventNameInput.value.trim();
  const description = eventDescriptionInput.value.trim();
  const localDatetime = eventTimeInput.value;

  if (!name || !description || !localDatetime) return;

  const when = new Date(localDatetime);
  if (Number.isNaN(when.getTime())) {
    alert("時間格式有誤");
    return;
  }

  await addDoc(collection(db, "users", currentUser.uid, "events"), {
    name,
    description,
    occurredAt: Timestamp.fromDate(when),
    createdAt: Timestamp.now(),
  });

  eventForm.reset();
  setDefaultDatetimeLocal();
  await loadEvents();
}

loginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    alert(`登入失敗：${error.message}`);
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

openaiKeyStatusBtn?.addEventListener("click", () => {
  const confirmed = window.confirm("確定要刪除已儲存的 OpenAI API Key 嗎？");
  if (!confirmed) return;
  removeOpenAIKey();
});

refreshBtn.addEventListener("click", loadEvents);
eventForm.addEventListener("submit", saveEvent);
updateOpenAIKeyStatus();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    userLabel.textContent = `已登入：${user.displayName ?? user.email ?? "使用者"}`;
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    entryCard.classList.remove("hidden");
    timelinesCard.classList.remove("hidden");
    try {
      await loadTimelineBackgrounds();
    } catch (error) {
      alert(`背景圖資料載入失敗：${error.message}`);
      timelineBackgrounds = {};
    }
    setDefaultDatetimeLocal();
    await loadEvents();
  } else {
    userLabel.textContent = "尚未登入";
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    entryCard.classList.add("hidden");
    timelinesCard.classList.add("hidden");
    timelinesContainer.innerHTML = "";
    if (eventNameSuggestions) eventNameSuggestions.innerHTML = "";
    timelineOpenState.clear();
    timelineEditModeState.clear();
    editingEventState.clear();
    generatingBackgroundState.clear();
    timelineBackgrounds = {};
  }
});
