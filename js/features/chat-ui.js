(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);

  const fab = $("#chatFab");
  const panel = $("#chatPanel");
  const closeBtn = $("#chatClose");

  const nickLabel = $("#nickLabel");
  const nickRightView = $("#nickRightView");
  const nickRightEdit = $("#nickRightEdit");
  const nickEdit = $("#nickEdit");
  const nickInput = $("#nickInput");
  const nickSave = $("#nickSave");
  const nickCancel = $("#nickCancel");

  const chatBody = $("#chatBody");
  const chatList = $("#chatList");
  const chatText = $("#chatText");
  const chatSend = $("#chatSend");

  if (!fab || !panel || !chatBody || !chatList || !chatText || !chatSend) return;

  const NICK_KEY = "kimp_chat_nick";
  const CHAT_OPEN_KEY = "kimp_chat_open";

  const MAX = 30;
  const FIREBASE_VERSION = "10.12.5";
  const SEND_COOLDOWN_MS = 1_000;

  const firebaseConfig = {
    apiKey: "AIzaSyCf74YfV8hNmMofeWmVeXtCpxB347Y52rs",
    authDomain: "kimpview-chat.firebaseapp.com",
    projectId: "kimpview-chat",
    storageBucket: "kimpview-chat.firebasestorage.app",
    messagingSenderId: "447913232565",
    appId: "1:447913232565:web:50996902f727800b82d6fc",
  };

  const BASE_USERS = 236;
  const chatOnlineEl = document.getElementById("chatOnline");

  const PRESENCE_TTL_MS = 70_000;
  const HEARTBEAT_MS = 30_000;
  const EXPIRE_AFTER_MS = 2 * 60_000;
  const PRESENCE_SESSION_KEY = "kimp_chat_session_id";

  const ONLINE_UI_DELAY_MS = 1000;
  let onlineUiTimer = null;

  let presenceStart = null;
  let presenceStop = null;

  const setOnlineCount = (n) => {
    if (!chatOnlineEl) return;
    chatOnlineEl.textContent = String(n);
  };

  const setOnlineCountDelayed = (n) => {
    if (!chatOnlineEl) return;
    if (onlineUiTimer) clearTimeout(onlineUiTimer);
    onlineUiTimer = setTimeout(() => {
      chatOnlineEl.textContent = String(n);
      onlineUiTimer = null;
    }, ONLINE_UI_DELAY_MS);
  };

  const getSessionId = () => {
    let id = sessionStorage.getItem(PRESENCE_SESSION_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `sid_${Math.random().toString(16).slice(2)}_${Date.now()}`);
      sessionStorage.setItem(PRESENCE_SESSION_KEY, id);
    }
    return id;
  };

  setOnlineCount(BASE_USERS);

  const pad2 = (n) => String(n).padStart(2, "0");

  const formatKoreanTime = (d = new Date()) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const ap = h < 12 ? "오전" : "오후";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${ap} ${hh}:${pad2(m)}`;
  };

  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const getNick = () => (localStorage.getItem(NICK_KEY) || "").trim();

  const isValidNick = (v) => {
    const s = (v || "").trim();
    return s.length >= 2 && s.length <= 12;
  };

  const isValidText = (v) => {
    const s = (v || "").trim();
    return s.length >= 1 && s.length <= 200;
  };

  const getInitial = (name) => {
    const s = (name || "").trim();
    if (!s) return "?";
    return s.slice(0, 1);
  };

  const scrollToBottom = () => {
    chatBody.scrollTop = chatBody.scrollHeight;
  };

  function renderNick() {
    const n = getNick();
    if (nickLabel) nickLabel.textContent = n ? n : "닉네임 설정";
  }

  function lockChat(locked) {
    if (locked) panel.classList.add("no-nick");
    else panel.classList.remove("no-nick");
    chatSend.disabled = locked;
    chatText.disabled = locked;
  }

  function openEdit() {
    if (nickRightView) nickRightView.hidden = true;
    if (nickRightEdit) nickRightEdit.hidden = false;
    if (nickInput) {
      nickInput.value = getNick();
      nickInput.focus();
      nickInput.select();
    }
    lockChat(true);
  }

  function closeEdit() {
    if (nickRightEdit) nickRightEdit.hidden = true;
    if (nickRightView) nickRightView.hidden = false;
    lockChat(!getNick());
  }

  function checkNick() {
    renderNick();
    const n = getNick();
    if (!n) openEdit();
    else closeEdit();
  }

  function openChatUIOnly() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    fab.classList.add("hidden");
    checkNick();
    scrollToBottom();
  }

  function openChat() {
    openChatUIOnly();
    chatText.focus();
    sessionStorage.setItem(CHAT_OPEN_KEY, "1");
    presenceStart?.();
  }

  function closeChat() {
    sessionStorage.setItem(CHAT_OPEN_KEY, "0");
    presenceStop?.();
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    fab.classList.remove("hidden");
    fab.focus();
  }

  fab.addEventListener("click", () => {
    panel.classList.contains("open") ? closeChat() : openChat();
  });

  closeBtn?.addEventListener("click", closeChat);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) closeChat();
  });

  nickEdit?.addEventListener("click", openEdit);

  nickCancel?.addEventListener("click", () => {
    if (!getNick()) return;
    closeEdit();
  });

  nickSave?.addEventListener("click", () => {
    const v = (nickInput?.value || "").trim();
    if (!isValidNick(v)) {
      alert("닉네임 (2~12자) 입력");
      nickInput?.focus();
      return;
    }
    localStorage.setItem(NICK_KEY, v);
    renderNick();
    closeEdit();
    chatText.focus();
  });

  nickInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nickSave?.click();
    if (e.key === "Escape") nickCancel?.click();
  });

  function buildMsgLi({ me, name, text, time }) {
    const safeName = escapeHtml(name);
    const safeText = escapeHtml(text);
    const safeTime = escapeHtml(time);
    const initial = escapeHtml(getInitial(name));

    const li = document.createElement("li");
    li.className = me ? "c-msg me" : "c-msg";

    li.innerHTML = `
      <div class="c-av">${initial}</div>
      <div class="c-bubbleWrap">
        <div class="c-name">${safeName}</div>
        <div class="c-bubbleRow">
          ${
            me
              ? `<div class="c-time">${safeTime}</div><div class="c-bubble">${safeText}</div>`
              : `<div class="c-bubble">${safeText}</div><div class="c-time">${safeTime}</div>`
          }
        </div>
      </div>
    `;
    return li;
  }

  function renderMessages(items) {
    const myNick = getNick();
    chatList.innerHTML = "";

    for (const m of items || []) {
      const name = (m.user || "").trim();
      const text = (m.text || "").trim();
      if (!name || !text) continue;

      const dt = m.createdAt instanceof Date ? m.createdAt : new Date();
      const time = formatKoreanTime(dt);
      const me = myNick && name === myNick;

      chatList.appendChild(buildMsgLi({ me, name, text, time }));
    }

    while (chatList.children.length > MAX) {
      chatList.removeChild(chatList.firstElementChild);
    }

    scrollToBottom();
  }

  const canSendNow = () => {
    const last = Number(sessionStorage.getItem("kimp_chat_last_send") || "0");
    return Date.now() - last >= SEND_COOLDOWN_MS;
  };

  const markSentNow = () => {
    sessionStorage.setItem("kimp_chat_last_send", String(Date.now()));
  };

  function sendCurrentInput(sendFn) {
    const nick = getNick();
    if (!nick) {
      checkNick();
      return;
    }

    const msg = (chatText.value || "").trim();
    if (!isValidText(msg)) return;

    if (!canSendNow()) {
      const left = Math.ceil(
        (SEND_COOLDOWN_MS -
          (Date.now() -
            Number(sessionStorage.getItem("kimp_chat_last_send") || "0"))) /
          1000
      );
      alert(`너무 빠릅니다. ${left}초 후 다시 전송하세요.`);
      return;
    }

    chatText.value = "";
    chatText.focus();

    markSentNow();
    sendFn(nick, msg);
  }

  const firebaseInit = async () => {
    const { initializeApp } = await import(
      `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`
    );

    const {
      getFirestore,
      collection,
      addDoc,
      query,
      orderBy,
      limit,
      onSnapshot,
      doc,
      setDoc,
    } = await import(
      `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`
    );

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const presenceCol = collection(db, "presence");
    const sid = getSessionId();
    const presenceDoc = doc(presenceCol, sid);

    let hbTimer = null;
    let started = false;

    const JOINED_INIT_KEY = `kimp_chat_joined_init_${sid}`;

    const upsertPresence = async () => {
      const expireAt = new Date(Date.now() + EXPIRE_AFTER_MS);

      const base = {
        nick: getNick() || "",
        lastSeen: new Date(), 
        expireAt,
      };

      if (!sessionStorage.getItem(JOINED_INIT_KEY)) {
        await setDoc(presenceDoc, { ...base, joinedAt: new Date() }, { merge: true });
        sessionStorage.setItem(JOINED_INIT_KEY, "1");
        return;
      }

      await setDoc(presenceDoc, base, { merge: true });
    };

    const start = async () => {
      if (started) return;
      started = true;

      await upsertPresence().catch((e) => console.error("presence write fail", e));

      hbTimer = setInterval(() => {
        upsertPresence().catch((e) => console.error("presence heartbeat fail", e));
      }, HEARTBEAT_MS);
    };

    const stop = () => {
      started = false;
      if (hbTimer) clearInterval(hbTimer);
      hbTimer = null;

      setDoc(
        presenceDoc,
        {
          lastSeen: new Date(0),
          expireAt: new Date(Date.now() + 60_000),
        },
        { merge: true }
      ).catch(() => {});
    };

    presenceStart = start;
    presenceStop = stop;

    window.addEventListener("beforeunload", stop);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) presenceStop?.();
      else if (panel.classList.contains("open")) presenceStart?.();
    });

    onSnapshot(
      presenceCol,
      (snap) => {
        const now = Date.now();
        let online = 0;

        snap.forEach((d) => {
          const data = d.data() || {};

          const ts =
            data.lastSeen && typeof data.lastSeen.toDate === "function"
              ? data.lastSeen.toDate().getTime()
              : (data.lastSeen instanceof Date ? data.lastSeen.getTime() : 0);

          if (ts && now - ts <= PRESENCE_TTL_MS) online += 1;
        });

        setOnlineCountDelayed(BASE_USERS + online);
      },
      (e) => console.error("presence snapshot fail", e)
    );

    const messagesRef = collection(db, "messages");
    const q = query(messagesRef, orderBy("createdAt", "desc"), limit(MAX));

    onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((docx) => {
          const data = docx.data() || {};
          const ts =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : null;

          return {
            user: data.user || "",
            text: data.text || "",
            createdAt: ts || new Date(),
          };
        })
        .reverse();

      renderMessages(items);
    });

    const sendFn = async (user, text) => {
      await addDoc(messagesRef, {
        user,
        text,
        createdAt: new Date(), 
      });
    };

    chatSend.addEventListener("click", () => sendCurrentInput(sendFn));

    chatText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCurrentInput(sendFn);
      }
    });

    if (sessionStorage.getItem(CHAT_OPEN_KEY) === "1") presenceStart?.();
  };

  renderNick();
  lockChat(!getNick());

  if (sessionStorage.getItem(CHAT_OPEN_KEY) === "1") {
    openChatUIOnly();
    setTimeout(() => chatText?.focus(), 0);
  }

  firebaseInit().catch((err) => {
    console.warn("Firebase init failed. Using fallback.", err);

    const fallbackSend = (user, text) => {
      const li = buildMsgLi({
        me: true,
        name: user,
        text,
        time: formatKoreanTime(),
      });
      chatList.appendChild(li);
      while (chatList.children.length > MAX)
        chatList.removeChild(chatList.firstElementChild);
      scrollToBottom();
    };

    chatSend.addEventListener("click", () => sendCurrentInput(fallbackSend));

    chatText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCurrentInput(fallbackSend);
      }
    });
  });
})();
