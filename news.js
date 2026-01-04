(() => {
  const PROXY_BASE = "https://news.cjstn3391.workers.dev";
  const $ = (id) => document.getElementById(id);

  const newsList = $("newsList");
  const newsEmpty = $("newsEmpty");
  const newsLoading = $("newsLoading");
  const moreBtn = $("newsMoreBtn");

  const NEWS_LS_KEY = "KIMPVIEW_NEWS_CACHE_V1";
  const NEWS_TTL_MS = 60_000; 

  const state = { all: [], rendered: 0, first: 20, step: 5, loading: false };

  function show(el) { if (el) el.style.display = ""; }
  function hide(el) { if (el) el.style.display = "none"; }

  function toTimeText(publishedAt) {
    if (!publishedAt) return "";
    const d = new Date(publishedAt);
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

  function normalizeItem(x) {
    const clean = (str) =>
      (str ?? "")
        .replace(/<[^>]*>?/gm, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");

    const defaultImg =
      "https://www.coinreaders.com/imgdata/coinreaders_com/202502/716_716_2025021156285571.jpg";

    return {
      title: clean(x.title),
      url: x.link,
      summary: clean(x.description),
      image: x.extractedImage || defaultImg,
      publishedAt: x.pubDate,
    };
  }

  function renderItem(item) {
    const timeText = esc(toTimeText(item.publishedAt));
    return `
      <li class="newsItem" style="list-style:none; border-bottom:1px solid #eee;">
        <div class="newsCard" role="button" tabindex="0" style="cursor:pointer; padding:15px;">
          <div class="newsMainRow" style="display:flex; gap:15px; align-items:flex-start;">
            <div class="newsThumb" style="width:118px; height:66px; flex-shrink:0; background:#f3f4f6; border-radius:10px; overflow:hidden;">
              <img src="${esc(item.image)}" alt="news" style="width:100%; height:100%; object-fit:cover;">
            </div>
            <div class="newsBody" style="flex:1; min-width:0;">
              <div class="newsTitleRow" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="newsTitle" style="font-weight:bold; font-size:15px; color:#111; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(item.title)}</div>
                <div class="newsTime" style="font-size:12px; color:#999; white-space:nowrap; margin-left:10px;">${timeText}</div>
              </div>
              <div class="newsSummary" style="margin-top:6px; font-size:13px; color:#4b5563; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
                ${esc(item.summary)}
              </div>
              <div class="newsFooter" style="display:none; margin-top:10px;">
                <a class="newsReadMore" href="${esc(item.url)}" target="_blank" style="font-size:12px; color:#000; text-decoration:none; border:1px solid #ddd; padding:4px 8px; border-radius:8px; background:#fff;">기사 전문 보기</a>
              </div>
            </div>
          </div>
        </div>
      </li>
    `;
  }

  function sortByPublishedDesc(list) {
    return list.slice().sort((a, b) => {
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }

  function renderFromState() {
    if (!newsList) return;

    newsList.innerHTML = "";
    state.rendered = 0;

    if (state.all.length === 0) {
      show(newsEmpty);
      newsEmpty.textContent = "최근 12시간 내 속보가 없습니다.";
      if (moreBtn) moreBtn.style.display = "none";
      return;
    }

    hide(newsEmpty);
    appendNext(state.first);
  }

  function appendNext(count) {
    const next = state.all.slice(state.rendered, state.rendered + count);
    if (newsList) newsList.insertAdjacentHTML("beforeend", next.map(renderItem).join(""));
    state.rendered += next.length;
    if (moreBtn) moreBtn.style.display = (state.rendered >= state.all.length) ? "none" : "";
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(NEWS_LS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.items)) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function saveCache(items) {
    try {
      localStorage.setItem(NEWS_LS_KEY, JSON.stringify({ ts: Date.now(), items }));
    } catch {}
  }

  async function fetchLatest() {
    const res = await fetch(`${PROXY_BASE}/news`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const raw = Array.isArray(json) ? json : (json.items || []);
    return sortByPublishedDesc(raw.map(normalizeItem));
  }

  async function loadAll() {
    if (state.loading) return;
    state.loading = true;

    const cached = loadCache();
    const freshEnough = cached && (Date.now() - (cached.ts || 0) < NEWS_TTL_MS);

    if (cached?.items?.length) {
      state.all = sortByPublishedDesc(cached.items);
      renderFromState();

      if (!freshEnough) show(newsLoading);
      else hide(newsLoading);
    } else {
      show(newsLoading);
    }

    try {
      const items = await fetchLatest();

      state.all = items;
      renderFromState();
      saveCache(items);

    } catch (e) {
      if (!cached?.items?.length) {
        show(newsEmpty);
        newsEmpty.textContent = "데이터 로드 실패";
      }
    } finally {
      hide(newsLoading);
      state.loading = false;
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

  loadAll();
})();
