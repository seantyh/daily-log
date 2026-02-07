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
  query,
  orderBy,
  getDocs,
  Timestamp,
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
const refreshBtn = document.getElementById("refreshBtn");
const timelinesContainer = document.getElementById("timelines");
const emptyMessage = document.getElementById("emptyMessage");

let currentUser = null;

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

function groupByName(events) {
  const grouped = new Map();
  for (const e of events) {
    if (!grouped.has(e.name)) grouped.set(e.name, []);
    grouped.get(e.name).push(e);
  }

  for (const [_, items] of grouped) {
    items.sort((a, b) => b.occurredAt.toMillis() - a.occurredAt.toMillis());
  }

  return [...grouped.entries()].sort((a, b) => {
    const latestA = a[1][0]?.occurredAt?.toMillis?.() ?? 0;
    const latestB = b[1][0]?.occurredAt?.toMillis?.() ?? 0;
    return latestB - latestA;
  });
}

function renderTimelines(events) {
  timelinesContainer.innerHTML = "";

  if (!events.length) {
    emptyMessage.classList.remove("hidden");
    return;
  }

  emptyMessage.classList.add("hidden");

  const grouped = groupByName(events);

  for (const [name, items] of grouped) {
    const timeline = document.createElement("section");
    timeline.className = "timeline";

    const title = document.createElement("h3");
    title.textContent = `${name}（${items.length}）`;
    timeline.appendChild(title);

    const list = document.createElement("ul");
    list.className = "timeline-list";

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "timeline-item";

      const time = document.createElement("div");
      time.className = "item-time";
      time.textContent = formatTimestamp(item.occurredAt);

      const desc = document.createElement("p");
      desc.className = "item-desc";
      desc.textContent = item.description;

      li.appendChild(time);
      li.appendChild(desc);
      list.appendChild(li);
    }

    timeline.appendChild(list);
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

refreshBtn.addEventListener("click", loadEvents);
eventForm.addEventListener("submit", saveEvent);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    userLabel.textContent = `已登入：${user.displayName ?? user.email ?? "使用者"}`;
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    entryCard.classList.remove("hidden");
    timelinesCard.classList.remove("hidden");
    setDefaultDatetimeLocal();
    await loadEvents();
  } else {
    userLabel.textContent = "尚未登入";
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    entryCard.classList.add("hidden");
    timelinesCard.classList.add("hidden");
    timelinesContainer.innerHTML = "";
  }
});
