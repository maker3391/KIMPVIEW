(() => {
  const PROXY_BASE = "https://news.cjstn3391.workers.dev";
  const $ = (id) => document.getElementById(id);

  const tabBreaking = $("tabBreaking");
  const tabNews = $("tabNews");

  const newsList = $("newsList");
  const newsEmpty = $("newsEmpty");
  const newsLoading = $("newsLoading");
  const moreBtn = $("newsMoreBtn");
  const newsSource = $("newsSource");

  const ENDPOINTS = {
    breaking: `${PROXY_BASE}/coinness/breaking`,
    news: `${PROXY_BASE}/news?display=50&metaLimit=50`,
  };

  const LS_KEYS = {
    breaking: "KIMPVIEW_BREAKING_CACHE_V1",
    news: "KIMPVIEW_NEWS_CACHE_V1",
    breakingCursor: "KIMPVIEW_BREAKING_CURSOR_V1",
  };

  const TTL_MS = {
    breaking: 5_000,
    news: 60_000,
  };

  const POLL_MS = 60_000;
  const NEWS_POLL_MS = 60_000;

  let pollTimer = null;
  let newsPollTimer = null;

  const state = {
    tab: "breaking",
    all: [],
    rendered: 0,
    first: 10,
    step: 5,
    loading: false,
  };

  function show(el) { if (el) el.style.display = ""; }
  function hide(el) { if (el) el.style.display = "none"; }

  function setSourceLabel(tab) {
    if (!newsSource) return;
    newsSource.textContent = (tab === "breaking") ? "출처: CoinNess" : "출처: Naver";
  }

  function parseDateAny(v) {
    if (v == null) return null;

    const s = String(v).trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;

      const ms = s.length <= 10 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    const fixed = (s.includes(" ") && !s.includes("T")) ? s.replace(" ", "T") : s;

    const d = new Date(fixed);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function toTimeText(publishedAt) {
    const d = parseDateAny(publishedAt);
    if (!d) return "";

    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);

    if (min < 1) return "방금 전";
    if (min < 60) return `${min}분 전`;

    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;

    return `${Math.floor(hr / 24)}일 전`;
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function cleanText(str) {
    return (str ?? "")
      .replace(/<[^>]*>?/gm, "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  }

  function isCoinnessShape(x) {
    return x && (
      typeof x.content === "string" ||
      typeof x.source === "string" ||
      "thumbnailImage" in x ||
      "publishAt" in x ||
      "updatedAt" in x
    );
  }

  function isNaverShape(x) {
    return x && (
      typeof x.pubDate === "string" ||
      typeof x.originallink === "string" ||
      typeof x.description === "string"
    );
  }

  function normalizeItem(x, tab) {
    const defaultImg = "../images/default.jpg";

    if (tab === "breaking") {
      if (isCoinnessShape(x)) {
        const publishedAt = x.publishAt || x.pubDate || "";
        const updatedAt = x.updatedAt || x.publishAt || x.pubDate || "";

        return {
          title: cleanText(x.title),
          url: x.source || x.link || x.originallink || "",
          summary: cleanText(x.content || x.description || ""),
          image: x.thumbnailImage || x.contentImage || x.extractedImage || defaultImg,
          publishedAt,
          updatedAt,
          displayAt: updatedAt || publishedAt, 
          badge: x.isImportant ? "중요" : (x.categoryName || ""),
        };
      }

      if (isNaverShape(x)) {
        const publishedAt = x.pubDate || "";
        return {
          title: cleanText(x.title),
          url: x.originallink || x.link || "",
          summary: cleanText(x.extractedDesc || x.description || ""),
          image: x.extractedImage || defaultImg,
          publishedAt,
          updatedAt: x.pubDate || "",
          displayAt: x.pubDate || "", 
          badge: "속보",
        };
      }

      const publishedAt = x.publishedAt || x.pubDate || "";
      const updatedAt = x.updatedAt || x.publishedAt || x.pubDate || "";
      return {
        title: cleanText(x.title),
        url: x.url || x.link || "",
        summary: cleanText(x.summary || x.description || ""),
        image: x.image || defaultImg,
        publishedAt,
        updatedAt,
        displayAt: updatedAt || publishedAt,
        badge: "속보",
      };
    }

    const publishedAt = x.pubDate || "";
    return {
      title: cleanText(x.title),
      url: x.originallink || x.link || "",
      summary: cleanText(x.extractedDesc || x.description || ""),
      image: x.extractedImage || defaultImg,
      publishedAt,
      updatedAt: x.pubDate || "",
      displayAt: x.pubDate || "",
      badge: "",
    };
  }

  function getSortTime(it) {
    const d = parseDateAny(it?.displayAt || it?.updatedAt || it?.publishedAt);
    return d ? d.getTime() : 0;
  }

  function renderItem(item) {
    const timeText = esc(toTimeText(item.displayAt || item.updatedAt || item.publishedAt));
    const badgeHtml = item.badge
      ? `<span style="display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:999px; font-size:12px; background:#eef2ff; color:#3730a3; margin-right:8px; white-space:nowrap;">${esc(item.badge)}</span>`
      : "";

    const isBreaking = state.tab === "breaking";
    const thumbHtml = isBreaking
      ? ""
      : `<div class="newsThumb">
          <img src="${esc(item.image)}" alt="news" onerror="this.onerror=null; this.src='../images/default.jpg';">
        </div>`;

    return `
      <li class="newsItem">
        <div class="newsCard" role="button" tabindex="0">
          <div class="newsMainRow">
            ${thumbHtml}
            <div class="newsBody">
              <div class="newsTitleRow">
                <div class="newsTitle">${badgeHtml}${esc(item.title)}</div>
                <div class="newsTime">${timeText}</div>
              </div>
              <div class="newsSummary">${esc(item.summary)}</div>
              <div class="newsFooter" style="display:none; margin-top:10px;">
                <a class="newsReadMore" href="${esc(item.url)}" target="_blank" rel="noopener">기사 원문 보기</a>
              </div>
            </div>
          </div>
        </div>
      </li>`;
  }

  function renderFromState() {
    if (!newsList) return;
    newsList.innerHTML = "";
    state.rendered = 0;

    if (state.all.length === 0) {
      show(newsEmpty);
      newsEmpty.textContent = state.tab === "breaking" ? "최근 속보가 없습니다." : "뉴스가 없습니다.";
      if (moreBtn) moreBtn.style.display = "none";
      return;
    }

    hide(newsEmpty);
    appendNext(state.first);
  }

  function appendNext(count) {
    const next = state.all.slice(state.rendered, state.rendered + count);
    if (next.length) {
      newsList?.insertAdjacentHTML("beforeend", next.map(renderItem).join(""));
      state.rendered += next.length;
    }
    updateMoreBtn();
  }

  function updateMoreBtn() {
    if (!moreBtn) return;
    const hasMore = state.rendered < state.all.length;
    moreBtn.style.display = hasMore ? "" : "none";
    if (hasMore) {
      moreBtn.disabled = false;
      moreBtn.textContent = "더보기";
    }
  }

  function itemKey(it) {
    const u = (it?.url || "").trim();
    const t = (it?.title || "").trim();
    const a = (it?.displayAt || it?.updatedAt || it?.publishedAt || "").trim();
    return `${u}__${a}__${t}`;
  }

  function dedupeKeepOrder(list) {
    const seen = new Set();
    const out = [];
    for (const it of list) {
      const k = itemKey(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  }

  function getLatestCursorFromState() {
    const first = state.all?.[0]; // newest
    const d = parseDateAny(first?.displayAt || first?.updatedAt || first?.publishedAt);
    return d ? d.toISOString() : "";
  }

  function loadBreakingCursor() {
    try { return (localStorage.getItem(LS_KEYS.breakingCursor) || "").trim(); } catch { return ""; }
  }

  function saveBreakingCursor(iso) {
    try { if (iso) localStorage.setItem(LS_KEYS.breakingCursor, iso); } catch {}
  }

  function loadCache(tab) {
    try {
      const raw = localStorage.getItem(LS_KEYS[tab]);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && Array.isArray(obj.items)) ? obj : null;
    } catch { return null; }
  }

  function saveCache(tab, items) {
    try { localStorage.setItem(LS_KEYS[tab], JSON.stringify({ ts: Date.now(), items })); } catch {}
  }

  async function fetchLatest(tab, opts = {}) {
    if (tab === "breaking") {
      const limit = 50;
      const hours = 24;
      const url = `${ENDPOINTS.breaking}?limit=${limit}&hours=${hours}`;

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();

      return raw
        .map((x) => normalizeItem(x, "breaking"))
        .sort((a, b) => getSortTime(b) - getSortTime(a)); 
    }

    const res = await fetch(ENDPOINTS.news, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const raw = Array.isArray(json) ? json : (json.items || []);

    return raw
      .map((x) => normalizeItem(x, "news"))
      .sort((a, b) => getSortTime(b) - getSortTime(a));
  }

  function stopBreakingPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function stopNewsPoll() { if (newsPollTimer) { clearInterval(newsPollTimer); newsPollTimer = null; } }

  function isNearBottom() {
    const el = document.scrollingElement || document.documentElement;
    const scrollTop = el.scrollTop || 0;
    const viewH = window.innerHeight || document.documentElement.clientHeight || 0;
    const docH = el.scrollHeight || 0;
    return (scrollTop + viewH) > (docH - 120);
  }

  function appendIncomingToDom(items) {
    if (!newsList || !items?.length) return;

    const html = items.map(renderItem).join("");

    if (state.tab === "breaking") {
      newsList.insertAdjacentHTML("afterbegin", html);
    } else {
      newsList.insertAdjacentHTML("beforeend", html);
    }

    state.rendered += items.length;
    updateMoreBtn();
  }

  function startBreakingPoll() {
    stopBreakingPoll();
    pollTimer = setInterval(async () => {
      if (state.loading || state.tab !== "breaking") return;

      try {
        const incoming = await fetchLatest("breaking");
        if (!incoming.length) return;

        const existed = new Set(state.all.map(itemKey));
        const onlyNew = incoming.filter((it) => {
          const k = itemKey(it);
          return k && !existed.has(k);
        });

        state.all = dedupeKeepOrder(incoming).sort((a, b) => getSortTime(b) - getSortTime(a));
        saveCache("breaking", state.all);

      if (onlyNew.length) {
        if (isNearBottom()) {
          const keepCount = Math.max(state.rendered, state.first);

          newsList.innerHTML = "";
          state.rendered = 0;

          appendNext(keepCount);
        } else {
          updateMoreBtn();
        }
      }
      } catch {}
    }, POLL_MS);
  }


  function startNewsPoll() {
    stopNewsPoll();
    newsPollTimer = setInterval(async () => {
      if (state.loading || state.tab !== "news") return;

      try {
        const incomingRaw = await fetchLatest("news");
        if (!incomingRaw.length) return;

        const existed = new Set(state.all.map(itemKey));
        const onlyNew = incomingRaw.filter((it) => {
          const k = itemKey(it);
          return k && !existed.has(k);
        });
        if (!onlyNew.length) return;

        state.all = dedupeKeepOrder([...onlyNew, ...state.all]).sort((a, b) => getSortTime(b) - getSortTime(a));
        saveCache("news", state.all);

        if (isNearBottom()) appendIncomingToDom(onlyNew);
        else updateMoreBtn();
      } catch {}
    }, NEWS_POLL_MS);
  }

  async function loadAll(tab, opts = {}) {
    if (state.loading) return;
    state.loading = true;
    state.tab = tab;
    setSourceLabel(tab);

    if (newsLoading) {
      newsLoading.textContent = "최신 소식을 불러오고 있습니다.";
      show(newsLoading);
    }
    if (moreBtn) moreBtn.style.display = "none";
    if (newsSource) newsSource.style.display = "none";
    hide(newsEmpty);

    if (tab === "breaking") { startBreakingPoll(); stopNewsPoll(); }
    else { stopBreakingPoll(); startNewsPoll(); }

    if (tabBreaking && tabNews) {
      const isBreaking = tab === "breaking";
      tabBreaking.classList.toggle("active", isBreaking);
      tabBreaking.setAttribute("aria-selected", isBreaking ? "true" : "false");
      tabNews.classList.toggle("active", !isBreaking);
      tabNews.setAttribute("aria-selected", !isBreaking ? "true" : "false");
    }

    if (newsList) newsList.innerHTML = "";

    const ignoreCache = !!opts.ignoreCache;

    if (!ignoreCache) {
      const cached = loadCache(tab);
      const freshEnough = cached && (Date.now() - (cached.ts || 0) < TTL_MS[tab]);
      if (cached?.items?.length) {
        state.all = cached.items
          .slice()
          .sort((a, b) => getSortTime(b) - getSortTime(a));

        renderFromState();
        if (freshEnough) hide(newsLoading);
      } else {
        show(newsLoading);
      }
    } else {
      show(newsLoading);
    }

    await new Promise((r) => requestAnimationFrame(r));

    try {
      const items = await fetchLatest(tab);

      state.all = dedupeKeepOrder(items).sort((a, b) => getSortTime(b) - getSortTime(a));
      renderFromState();
      saveCache(tab, state.all);

    } catch {
      const cached = ignoreCache ? null : loadCache(tab);
      if (!cached?.items?.length) {
        show(newsEmpty);
        newsEmpty.textContent = "데이터 로드 실패";
      }
    } finally {
      hide(newsLoading);
      state.loading = false;
      if (newsSource) newsSource.style.display = "";
      updateMoreBtn();
    }
  }

  newsList?.addEventListener("click", (e) => {
    if (e.target.closest(".newsReadMore")) return;
    const card = e.target.closest(".newsCard");
    if (!card) return;

    const summary = card.querySelector(".newsSummary");
    const footer = card.querySelector(".newsFooter");
    const title = card.querySelector(".newsTitle");
    const isOpen = card.classList.toggle("open");

    if (isOpen) {
      summary.style.display = "block";
      summary.style.webkitLineClamp = "unset";
      summary.style.maxHeight = "1000px";
      title.style.whiteSpace = "normal";
      if (footer) footer.style.display = "block";
    } else {
      summary.style.display = "-webkit-box";
      summary.style.webkitLineClamp = "2";
      summary.style.maxHeight = "calc(1.45em * 2)";
      title.style.whiteSpace = "nowrap";
      if (footer) footer.style.display = "none";
    }
  });

  moreBtn?.addEventListener("click", () => appendNext(state.step));
  tabBreaking?.addEventListener("click", () => loadAll("breaking", { ignoreCache: true }));
  tabNews?.addEventListener("click", () => loadAll("news", { ignoreCache: true }));

  loadAll("breaking", { ignoreCache: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopBreakingPoll();
      stopNewsPoll();
    } else {
      if (state.tab === "breaking") startBreakingPoll();
      if (state.tab === "news") startNewsPoll();
    }
  });
})();
