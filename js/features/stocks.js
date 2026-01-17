(() => {
  const PROXY_BASE = "https://kimpview-proxy.cjstn3391.workers.dev";
  const MARKET = "us"; 

  const DEFAULT_SYMBOLS_US = [
    "NVDA","GOOG","AAPL","MSFT","AMZN",
    "META","AVGO","TSLA","BRK-B","LLY",
    "WMT","JPM","V","ORCL","XOM",
    "MA","JNJ","PLTR","BAC","COST"
  ];

  const STOCK_NAME_KR = {
    NVDA:"엔비디아",
    GOOG:"알파벳(구글)",
    AAPL:"애플",
    MSFT:"마이크로소프트",
    AMZN:"아마존",
    META:"메타",
    AVGO:"브로드컴",
    TSLA:"테슬라",
    "BRK-B":"버크셔 해서웨이",
    LLY:"일라이 릴리",
    WMT:"월마트",
    JPM:"JP모건",
    V:"비자",
    ORCL:"오라클",
    XOM:"엑슨모빌",
    MA:"마스터카드",
    JNJ:"존슨앤드존슨",
    PLTR:"팔란티어",
    BAC:"뱅크오브아메리카",
    COST:"코스트코"
  };

  const TV_EXCHANGE_MAP = {
    "BRK-B":"NYSE",
    "WMT":"NYSE",
    "JPM":"NYSE",
    "V":"NYSE",
    "ORCL":"NYSE",
    "XOM":"NYSE",
    "MA":"NYSE",
    "JNJ":"NYSE",
    "BAC":"NYSE",
    "COST":"NASDAQ",
  };

  const $ = (id) => document.getElementById(id);

  const el = {
    searchInput: $("searchInput"),
    applyBtn: $("applyBtn"),
    clearBtn: $("clearSearchBtn"),
    favOnly: $("favoriteOnlyInline"),
    tbody: $("stocksTableBody"),
    status: $("stocksStatus"),
  };

  const state = {
    query: "",
    favOnly: false,
    sortKey: "mcap",
    sortDir: "desc",
    rows: [],
    _loading: false,
  };

  const CACHE_KEY = "KIMPVIEW_STOCKS_ROWS_V1";
  const CACHE_TTL = 3 * 60 * 1000; 

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.t || !Array.isArray(obj.rows) || obj.market !== MARKET) return null;
      if (Date.now() - obj.t > CACHE_TTL) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function writeCache(rows, updatedAtText) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        t: Date.now(),
        market: MARKET,
        rows,
        updatedAtText: updatedAtText || ""
      }));
    } catch {}
  }

  function num(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  }

  function clsChange(pct) {
    if (!Number.isFinite(pct) || Math.abs(pct) < 0.005) return "zero";
    return pct > 0 ? "plus" : "minus";
  }

  function signPct(pct) {
    if (!Number.isFinite(pct)) return "";
    return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }

  const getExchangeRate = () => Number(window.__GLOBAL_FX_RATE);

  function fmtCompactKRW_fromUSD(usdVal) {
    const usd = Number(usdVal);
    const fx = getExchangeRate();

    if (!Number.isFinite(usd) || usd === 0) return "";
    if (!Number.isFinite(fx) || fx <= 0) return "";

    const krw = usd * fx;
    const abs = Math.abs(krw);

    if (abs >= 1e12) {
      const jo = Math.floor(krw / 1e12);
      const eok = Math.floor((krw % 1e12) / 1e8);
      if (eok > 0) return `${jo.toLocaleString("ko-KR")}조 ${eok.toLocaleString("ko-KR")}억`;
      return `${jo.toLocaleString("ko-KR")}조`;
    }
    if (abs >= 1e8) {
      const eok = Math.floor(krw / 1e8);
      return `${eok.toLocaleString("ko-KR")}억`;
    }
    if (abs >= 1e4) {
      const man = Math.floor(krw / 1e4);
      return `${man.toLocaleString("ko-KR")}만`;
    }
    return `${Math.floor(krw).toLocaleString("ko-KR")}원`;
  }

  function fmtMcapKRW_Short(usdVal) {
    const usd = Number(usdVal);
    const fx = getExchangeRate();
    if (!Number.isFinite(usd) || !Number.isFinite(fx) || fx <= 0) return "";

    const krw = usd * fx;
    const abs = Math.abs(krw);

    if (abs >= 1e12) return `${(krw / 1e12).toFixed(2)}조`;
    if (abs >= 1e8)  return `${Math.floor(krw / 1e8).toLocaleString("ko-KR")}억`;
    return `${Math.floor(krw).toLocaleString("ko-KR")}원`;
  }

  function fmtUSD(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    }).format(n);
  }

  function fmtKRW(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    return `₩${Math.round(n).toLocaleString("ko-KR")}`;
  }

  function fmtMcapUSD(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return "";

    const abs = Math.abs(n);
    if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
    return `$${Math.floor(n).toLocaleString("en-US")}`;
  }

  function fmtVolUSD(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return "";

    const abs = Math.abs(n);
    if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
    return `$${Math.floor(n).toLocaleString("en-US")}`;
  }

  function buildPriceStack(priceUSD) {
    const fx = getExchangeRate();
    const p = Number(priceUSD);
    if (!Number.isFinite(p)) return { main: "", sub: "" };
    if (!Number.isFinite(fx) || fx <= 0) return { main: fmtUSD(p), sub: "" };
    return { main: fmtUSD(p), sub: fmtKRW(p * fx) };
  }

  function getStockIconUrl(symbol) {
    const s = String(symbol || "").toUpperCase().trim();
    return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(s)}.png`;
  }

  function getStockIconCandidates(symbol) {
    const s = String(symbol || "").toUpperCase().trim();
    if (s === "AMZN") return ["../images/custom/amzn.png", getStockIconUrl("AMZN")];
    if (s === "PLTR") return ["../images/custom/pltr.png", getStockIconUrl("PLTR")];
    if (s === "V") return ["../images/custom/visa.png", getStockIconUrl("V")];
    
    return [getStockIconUrl(s)];
  }

  function setIconWithFallback(imgEl, fallbackEl, symbol) {
    const urls = getStockIconCandidates(symbol);
    let idx = 0;

    const tryNext = () => {
      if (idx >= urls.length) {
        imgEl.style.display = "none";
        fallbackEl.style.display = "";
        return;
      }
      imgEl.src = urls[idx++];
    };

    imgEl.onload = () => {
      imgEl.style.display = "";
      fallbackEl.style.display = "none";
    };

    imgEl.onerror = () => tryNext();

    fallbackEl.style.display = "";
    tryNext();
  }

  function getStarSvg(filled) {
    if (filled) {
      return `
        <svg class="iconStar" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor"
            d="M12 17.3l-5.1 3 1.4-5.8-4.5-3.8 5.9-.5L12 4.8l2.3 5.4 5.9.5-4.5 3.8 1.4 5.8z"/>
        </svg>`;
    }
    return `
      <svg class="iconStar" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"
          d="M12 17.3l-5.1 3 1.4-5.8-4.5-3.8 5.9-.5L12 4.8l2.3 5.4 5.9.5-4.5 3.8 1.4 5.8z"/>
      </svg>`;
  }

  const FAV_KEY = "KIMPVIEW_STOCKS_FAVS_V1";
  function loadFavs() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []); }
    catch { return new Set(); }
  }
  function saveFavs(set) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(set))); }
    catch {}
  }
  const favs = loadFavs();

  function fmtKstDateTime(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}.${mm}.${dd} ${hh}:${min} (KST)`;
  }

  function setUpdatedAt(text) {
    const t = document.getElementById("stocksUpdatedAt");
    if (t) t.textContent = text;
  }

  function normalizeStock(obj) {
    const symbol = String(obj?.symbol ?? "").toUpperCase().trim();
    const rawName = STOCK_NAME_KR[symbol] ?? obj?.name ?? symbol;
    const name = String(rawName).trim() || symbol;

    const price = num(obj?.price);
    const prev = num(obj?.prev || obj?.previousClose || obj?.prevClose);

    const pctChange = Number.isFinite(num(obj?.pctChange))
      ? num(obj?.pctChange)
      : (Number.isFinite(price) && Number.isFinite(prev) && prev !== 0)
        ? ((price - prev) / prev) * 100
        : NaN;

    const mcap = num(obj?.mcap || obj?.marketCap || obj?.market_cap);
    const volumeDollar = num(obj?.volumeDollar || obj?.volume || obj?.totalValue || obj?.turnover);

    return { symbol, name, price, pctChange, mcap, volumeDollar };
  }

  async function fetchStockBatch(symbols) {
    const url = `${PROXY_BASE}/stocks?symbols=${encodeURIComponent(symbols.join(","))}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const items = Array.isArray(j) ? j : (j?.items || []);
    return items.map(normalizeStock);
  }

  function mapSortKey(raw) {
    if (raw === "change") return "pctChange";
    if (raw === "volume") return "volumeDollar";
    return raw;
  }

  function getViewRows() {
    let view = state.rows.slice();

    if (state.favOnly) view = view.filter(r => favs.has(r.symbol));

    if (state.query) {
      const q = state.query.toUpperCase();
      view = view.filter(r =>
        (r.symbol || "").toUpperCase().includes(q) ||
        (r.name || "").toUpperCase().includes(q)
      );
    }

    const key = state.sortKey;
    const dir = state.sortDir;

    view.sort((a, b) => {
      const af = favs.has(a.symbol);
      const bf = favs.has(b.symbol);
      if (af !== bf) return af ? -1 : 1;

      const av = Number.isFinite(num(a?.[key])) ? num(a[key]) : -Infinity;
      const bv = Number.isFinite(num(b?.[key])) ? num(b[key]) : -Infinity;
      const diff = av - bv;
      return dir === "asc" ? diff : -diff;
    });

    return view;
  }

  function syncSortUI() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      const raw = th.getAttribute("data-sort");
      const key = mapSortKey(raw);

      th.classList.toggle("is-active", key === state.sortKey);
      th.classList.toggle("is-asc", key === state.sortKey && state.sortDir === "asc");
      th.classList.toggle("is-desc", key === state.sortKey && state.sortDir === "desc");
    });
  }

  function setSort(rawKey) {
    const key = mapSortKey(rawKey);

    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else {
      state.sortKey = key;
      state.sortDir = "desc";
    }
    render(true);
  }

  function ensureTvReadyThen(cb, retry = 0) {
    if (window.TradingView && window.TradingView.widget) return cb();
    if (retry >= 60) return;
    setTimeout(() => ensureTvReadyThen(cb, retry + 1), 100);
  }

  function deferMount(cb) {
    if ("requestIdleCallback" in window) requestIdleCallback(cb, { timeout: 1200 });
    else setTimeout(cb, 0);
  }

  function mountTopChartDeferred() {
    const doMount = () => ensureTvReadyThen(() => {
      mountTvInto("tradingview_main_chart", "FOREXCOM:NAS100");
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if ("requestIdleCallback" in window) requestIdleCallback(doMount, { timeout: 1500 });
        else setTimeout(doMount, 350);
      });
    });
  }

  function toTvSymbol(symbol) {
    return `${TV_EXCHANGE_MAP[symbol] || "NASDAQ"}:${symbol}`;
  }

  function mountTvInto(containerId, tvSymbol) {
    if (!window.TradingView || !window.TradingView.widget) return false;
    const host = document.getElementById(containerId);
    if (!host) return false;

    host.innerHTML = "";

    const innerId = `${containerId}__inner`;
    const inner = document.createElement("div");
    inner.id = innerId;
    inner.style.width = "100%";
    inner.style.height = "100%";
    host.appendChild(inner);

    new window.TradingView.widget({
      autosize: true,
      symbol: tvSymbol,
      interval: "15",
      timezone: "Asia/Seoul",
      theme: "light",
      style: "1",
      locale: "kr",
      enable_publishing: false,
      allow_symbol_change: true,
      container_id: innerId,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      save_image: false,
    });

    return true;
  }

  // ===== Inline Row Chart (Max 2) =====
  const MAX_ROW_CHARTS = 2;
  let openedCharts = []; 

  function removeRowChartBySymbol(tvSymbol) {
    const idx = openedCharts.findIndex(x => x.symbol === tvSymbol);
    if (idx >= 0) {
      openedCharts[idx].tr?.remove();
      openedCharts.splice(idx, 1);
    }
  }

  function removeAllRowCharts() {
    for (const x of openedCharts) x.tr?.remove();
    openedCharts = [];
  }

  function isRowChartOpen(tvSymbol) {
    return openedCharts.some(x => x.symbol === tvSymbol);
  }

  function getVisibleColCount(tr) {
    const tds = Array.from(tr.children);
    const visible = tds.filter(td => {
      const cs = getComputedStyle(td);
      return cs.display !== "none" && cs.visibility !== "collapse";
    });
    return Math.max(1, visible.length);
  }

  function insertRowChart(afterTr, tvSymbol) {
    if (isRowChartOpen(tvSymbol)) {
      removeRowChartBySymbol(tvSymbol);
      return;
    }

    if (openedCharts.length >= MAX_ROW_CHARTS) {
      const oldest = openedCharts.shift();
      oldest?.tr?.remove();
    }

    const colCount = getVisibleColCount(afterTr); 
    const chartTr = document.createElement("tr");
    chartTr.className = "chartRow";

    const hostId = `rowChart_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    chartTr.innerHTML = `
      <td colspan="${colCount}">
        <div class="rowChartWrap">
          <div id="${hostId}" style="width:100%;height:100%;"></div>
        </div>
      </td>
    `;

    afterTr.insertAdjacentElement("afterend", chartTr);
    openedCharts.push({ symbol: tvSymbol, tr: chartTr });

    const host = document.getElementById(hostId);
    if (host) host.innerHTML = `<div style="padding:14px;color:#9ca3af;">Loading chart...</div>`;

    deferMount(() => ensureTvReadyThen(() => mountTvInto(hostId, tvSymbol)));
  }

  // ===== DOM refs cache =====
  const domRef = new Map();
  function cacheRefs(symbol, refs) { domRef.set(symbol, refs); }

  function computeDiffText(row) {
    let pctText = "";
    let diffText = "";

    if (Number.isFinite(row.pctChange) && Number.isFinite(row.price)) {
      pctText = signPct(row.pctChange);

      const prev = row.price / (1 + row.pctChange / 100);
      const diff = row.price - prev;

      diffText =
        (diff > 0 ? "+" : "") +
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2
        }).format(diff);
    }
    return { pctText, diffText };
  }

  function updateOneRow(symbol, row) {
    const refs = domRef.get(symbol);
    if (!refs) return;

    refs.nameDiv.textContent = row.name;

    const ps = buildPriceStack(row.price);
    refs.priceMain.textContent = ps.main;
    refs.priceSub.textContent = ps.sub;

    const chCls = clsChange(row.pctChange);
    refs.changeTd.className = `td-right changeStack ${chCls}`;

    const { pctText, diffText } = computeDiffText(row);
    refs.chgMain.className = `chgMain change ${chCls}`;
    refs.chgMain.textContent = pctText;
    refs.chgSub.textContent = diffText;

    refs.mcapMain.textContent = fmtMcapKRW_Short(row.mcap);
    refs.mcapSub.textContent  = fmtMcapUSD(row.mcap);

    refs.volMain.textContent = fmtCompactKRW_fromUSD(row.volumeDollar);
    refs.volSub.textContent  = fmtVolUSD(row.volumeDollar);
  }

  function renderRow(r) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-symbol", r.symbol);

    const isFav = favs.has(r.symbol);
    const first = (r.symbol && r.symbol[0]) ? r.symbol[0] : "?";

    const td0 = document.createElement("td");
    td0.className = "td-left";

    const assetCell = document.createElement("div");
    assetCell.className = "assetCell";

    const iconWrap = document.createElement("span");
    iconWrap.className = "assetIconWrap";

    const iconImg = document.createElement("img");
    iconImg.className = "assetIconImg assetIcon--stock";
    iconImg.alt = r.symbol;
    iconImg.loading = "lazy";
    iconImg.decoding = "async";
    iconImg.referrerPolicy = "no-referrer";

    const iconFallback = document.createElement("span");
    iconFallback.className = "assetIconFallback assetIconImg assetIcon--stock";
    iconFallback.textContent = first;

    setIconWithFallback(iconImg, iconFallback, r.symbol);
    iconWrap.appendChild(iconImg);
    iconWrap.appendChild(iconFallback);

    const assetText = document.createElement("div");
    assetText.className = "assetText";

    const nameDiv = document.createElement("div");
    nameDiv.className = "assetName";
    nameDiv.textContent = r.name;

    const sub = document.createElement("div");
    sub.className = "assetSub";

    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = `favBtn ${isFav ? "active" : ""}`;
    favBtn.innerHTML = getStarSvg(isFav);
    favBtn.setAttribute("aria-label", "즐겨찾기");

    const symSpan = document.createElement("span");
    symSpan.className = "assetSym";
    symSpan.textContent = r.symbol;

    const chartMini = document.createElement("span");
    chartMini.className = "chartMini";
    chartMini.title = "차트 보기";
    chartMini.setAttribute("aria-hidden", "true");

    sub.appendChild(favBtn);
    sub.appendChild(symSpan);
    sub.appendChild(chartMini);

    assetText.appendChild(nameDiv);
    assetText.appendChild(sub);

    assetCell.appendChild(iconWrap);
    assetCell.appendChild(assetText);
    td0.appendChild(assetCell);

    const td1 = document.createElement("td");
    td1.className = "td-right priceStack";

    const p = buildPriceStack(r.price);
    const pMain = document.createElement("span");
    pMain.className = "priceMain";
    pMain.textContent = p.main;

    const pSub = document.createElement("span");
    pSub.className = "priceSub";
    pSub.textContent = p.sub;

    td1.appendChild(pMain);
    td1.appendChild(pSub);

    const td2 = document.createElement("td");
    td2.className = `td-right changeStack ${clsChange(r.pctChange)}`;

    const { pctText, diffText } = computeDiffText(r);

    const pctSpan = document.createElement("span");
    pctSpan.className = `chgMain change ${clsChange(r.pctChange)}`;
    pctSpan.textContent = pctText;

    const diffSpan = document.createElement("span");
    diffSpan.className = "chgSub";
    diffSpan.textContent = diffText;

    td2.appendChild(pctSpan);
    td2.appendChild(diffSpan);

    const td3 = document.createElement("td");
    td3.className = "td-right mcapStack col-hide-980";

    const mcapMain = document.createElement("span");
    mcapMain.className = "mcapMain";
    mcapMain.textContent = fmtMcapKRW_Short(r.mcap);

    const mcapSub = document.createElement("span");
    mcapSub.className = "mcapSub";
    mcapSub.textContent = fmtMcapUSD(r.mcap);

    td3.appendChild(mcapMain);
    td3.appendChild(mcapSub);

    const td4 = document.createElement("td");
    td4.className = "td-right volStack col-hide-980";

    const volMain = document.createElement("span");
    volMain.className = "volMain";
    volMain.textContent = fmtCompactKRW_fromUSD(r.volumeDollar);

    const volSub = document.createElement("span");
    volSub.className = "volSub";
    volSub.textContent = fmtVolUSD(r.volumeDollar);

    td4.appendChild(volMain);
    td4.appendChild(volSub);

    tr.appendChild(td0);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td4);
    tr.appendChild(td3);

    cacheRefs(r.symbol, {
      tr,
      nameDiv,
      priceMain: pMain,
      priceSub: pSub,
      changeTd: td2,
      chgMain: pctSpan,
      chgSub: diffSpan,
      mcapMain,
      mcapSub,
      volMain,
      volSub,
      favBtn,
    });

    favBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (favs.has(r.symbol)) favs.delete(r.symbol);
      else favs.add(r.symbol);

      saveFavs(favs);
      const nowFav = favs.has(r.symbol);
      favBtn.classList.toggle("active", nowFav);
      favBtn.innerHTML = getStarSvg(nowFav);

      render(true);
    });

    chartMini.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tv = toTvSymbol(r.symbol);
      insertRowChart(tr, tv);
    });

    tr.addEventListener("click", () => {
      const tv = toTvSymbol(r.symbol);
      insertRowChart(tr, tv);
    });

    return tr;
  }

  function setStatus(text) {
    if (!el.status) return;
    if (!text) {
      el.status.style.display = "none";
      el.status.textContent = "";
      return;
    }
    el.status.style.display = "block";
    el.status.textContent = text;
  }

  function render(fullRender = true) {
    if (!el.tbody) return;

    const rows = getViewRows();

    if (!rows.length) {
      el.tbody.innerHTML = "";
      domRef.clear();
      removeAllRowCharts();

      const tr = document.createElement("tr");
      const msg = state.favOnly
        ? "즐겨찾기한 종목이 없습니다."
        : state.query
          ? "검색 결과가 없습니다."
          : "표시할 데이터가 없습니다.";

      tr.innerHTML = `
        <td colspan="5" style="padding:24px;text-align:center;color:#6b7280;">
          ${msg}
        </td>
      `;
      el.tbody.appendChild(tr);

      syncSortUI();
      return;
    }

    if (fullRender) {
      removeAllRowCharts();
      domRef.clear();
      el.tbody.innerHTML = "";
      const frag = document.createDocumentFragment();
      rows.forEach(r => frag.appendChild(renderRow(r)));
      el.tbody.appendChild(frag);
      syncSortUI();
      return;
    }

    for (const r of rows) updateOneRow(r.symbol, r);
  }

  function bindEvents() {
    document.addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (!th) return;

      const raw = th.getAttribute("data-sort");
      if (!raw) return;

      setSort(raw);
    });

    if (el.applyBtn) {
      el.applyBtn.addEventListener("click", () => {
        state.query = (el.searchInput?.value || "").trim();
        if (el.clearBtn) el.clearBtn.style.display = state.query ? "" : "none";
        render(true);
      });
    }

    if (el.searchInput) {
      el.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") el.applyBtn?.click();
      });
    }

    if (el.clearBtn) {
      el.clearBtn.addEventListener("click", () => {
        state.query = "";
        if (el.searchInput) el.searchInput.value = "";
        el.clearBtn.style.display = "none";
        render(true);
      });
    }

    if (el.favOnly) {
      el.favOnly.addEventListener("change", () => {
        state.favOnly = !!el.favOnly.checked;
        render(true);
      });
    }
  }

  async function refresh(forceFullRender = false) {
    if (state._loading) return;
    state._loading = true;

    const symbols = DEFAULT_SYMBOLS_US;

    if (!forceFullRender && state.rows.length === 0) {
      const cached = readCache();
      if (cached && cached.rows.length) {
        state.rows = cached.rows;
        render(true);
        if (cached.updatedAtText) setUpdatedAt(cached.updatedAtText);
      }
    }

    if (forceFullRender || !state.rows.length) {
      domRef.clear();
      removeAllRowCharts();
      if (el.tbody) el.tbody.innerHTML = "";
      setStatus("");
      setUpdatedAt("");
    }

    try {
      const data = await fetchStockBatch(symbols);
      const map = new Map(data.map(r => [r.symbol, r]));
      state.rows = symbols.map(s => map.get(s) || normalizeStock({ symbol: s, name: STOCK_NAME_KR[s] || s }));

      setStatus("");
      const nowText = fmtKstDateTime();
      setUpdatedAt(nowText);

      render(forceFullRender);

      writeCache(state.rows, nowText);

    } catch (e) {
      console.error(e);

      if (!state.rows.length) {
        setStatus("데이터를 불러오지 못했습니다.");
        if (el.tbody) el.tbody.innerHTML = "";
        domRef.clear();
      }
    } finally {
      state._loading = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    mountTopChartDeferred();

    const cached = readCache();
    if (cached && cached.rows.length) {
      state.rows = cached.rows;
      render(true);
      if (cached.updatedAtText) setUpdatedAt(cached.updatedAtText);
    }

    if ("requestIdleCallback" in window) requestIdleCallback(() => refresh(true), { timeout: 1500 });
    else setTimeout(() => refresh(true), 200);
    setInterval(() => refresh(false), 60000);
  });
})();