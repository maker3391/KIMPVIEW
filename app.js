(() => {
  // ===== DOM =====
  const exchangeSelect = document.getElementById("exchangeSelect");
  const searchInput = document.getElementById("searchInput");
  const applyBtn = document.getElementById("applyBtn");
  const favoriteOnlyInline = document.getElementById("favoriteOnlyInline");
  const coinTableBody = document.getElementById("coinTableBody");
  const sortableThs = document.querySelectorAll("th.sortable[data-sort]");
  const clearSearchBtn = document.getElementById("clearSearchBtn");

  if (!coinTableBody) {
    console.warn("[KIMPVIEW] #coinTableBody 없음. HTML id 확인!");
    return;
  }

  // ===== STATE =====
  const LS_KEY = "kimpview:favorites";

  // 김프 제외 코인 (Binance UI 기준 미지원)
  const KIMP_EXCLUDE = new Set([]);

  const state = {
    exchange: exchangeSelect?.value || "upbit_krw",
    query: "",
    favOnly: false,
    sortKey: "volKRW",
    sortDir: "desc",
    _sortedOnce: false,
    favorites: loadFavorites(),
    coins: [],
    _refreshTimer: null,
    _aborter: null,
    _isLoading: false,
    _topMetricsLoading: false,

    // 환율/USDT 캐시
    fxKRW: 0,
    usdtKRW: 0,

    // Binance ticker 캐시
    _binance: { map: new Map(), ts: 0, ttlMs: 3000 },
    _binance24h: { map: new Map(), ts: 0, ttlMs: 3000 },
  };

  // 이전 현재가 저장(상승/하락 배경용)
  const prevPriceMap = new Map(); // symbol -> prev priceKRW

  // ===== INIT =====
  bindEvents();
  bindAlertCollapse();      
  toggleClearBtn();

  loadTopMetrics();
  setInterval(loadTopMetrics, 60_000);

  loadCoinsAndRender(true);
  startAutoRefresh(3000);

  // ===== ALERT DOM =====
  const $longRate = document.getElementById("longRate");
  const $shortRate = document.getElementById("shortRate");
  const $fearGreed = document.getElementById("fearGreed");

  const $tradeAlertBody = document.getElementById("tradeAlertBody");
  const $liquidAlertBody = document.getElementById("liquidAlertBody");

  // ===== ALERT STATE =====
  let sideState = {
    tradeRows: [],
    liqRows: [],
  };

  // 빈칸 10줄 고정용 더미 행
  function makeEmptyRow() {
    return { sym: "", type: "", label: null, amount: null, price: null, time: null };
  }

  // 공통 렌더 (trade / liq)
  function renderAlert(kind) {
    const tbody = (kind === "trade") ? $tradeAlertBody : $liquidAlertBody;
    if (!tbody) return;

    const rows = (kind === "trade") ? sideState.tradeRows : sideState.liqRows;

    tbody.innerHTML = rows.map(r => {
      const labelText = (r.label == null || r.label === "") ? "&nbsp;" : escapeHtml(String(r.label));
      const timeText = (r.time == null || r.time === "") ? "&nbsp;" : escapeHtml(String(r.time));
      const amountText = (r.amount == null) ? "&nbsp;" : escapeHtml(formatKoreanMoneyKRW(r.amount) || "");
      const priceText = (r.price != null && Number.isFinite(r.price))
        ? escapeHtml("$" + Number(r.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        : "&nbsp;";

      // row class 
      let trClass = "";
      if (kind === "trade") {
        trClass = (r.type === "롱") ? "buy" : (r.type === "숏") ? "sell" : "";
      } else {
        // liq
        const isLong = String(r.type || r.label || "").includes("롱");
        const isShort = String(r.type || r.label || "").includes("숏");
        trClass = `liq ${isLong ? "long" : isShort ? "short" : ""}`.trim();
      }

      const labelCell = (r.label == null || r.label === "")
        ? "&nbsp;"
        : `<span class="labelWithEx"><img class="exIcon" src="images/binance.png" alt="Binance">${labelText}</span>`;

      return `
        <tr class="${trClass}">
          <td>${labelCell}</td>
          <td>${amountText}</td>
          <td>${priceText}</td>
          <td>${timeText}</td>
        </tr>
      `;
    }).join("");
  }

  function renderTrade() { renderAlert("trade"); }
  function renderLiq() { renderAlert("liq"); }

  function pushTradeRow({ sym, type, amountKRW, priceUSD }) {
    sideState.tradeRows.unshift({
      sym,
      type,
      label: `${sym} ${type}`,
      amount: amountKRW,
      price: priceUSD,
      time: nowTime(),
    });
    sideState.tradeRows = sideState.tradeRows.slice(0, 10);
    renderTrade();
  }

  function pushLiqRow({ sym, liqType, amountKRW, priceUSD }) {
    sideState.liqRows.unshift({
      sym,
      type: liqType,
      label: `${sym} ${liqType}`,
      amount: amountKRW,
      price: priceUSD,
      time: nowTime(),
    });
    sideState.liqRows = sideState.liqRows.slice(0, 10);
    renderLiq();
  }

  // 알림 테이블: 초기 빈칸 10줄
  sideState.tradeRows = Array.from({ length: 10 }, makeEmptyRow);
  sideState.liqRows = Array.from({ length: 10 }, makeEmptyRow);
  renderTrade();
  renderLiq();

  // ===== COLLAPSE =====
  function bindAlertCollapse() {
   
    const btns = document.querySelectorAll(".collapseBtn[data-target]");
    if (btns.length > 0) {
      btns.forEach((btn) => {
        const key = String(btn.dataset.target || "");
        const bodyId = (key === "trade") ? "tradeBody" : (key === "liq") ? "liqBody" : "";
        const body = bodyId ? document.getElementById(bodyId) : null;
        if (!body) return;

        const storageKey = `kimpview:${key}Collapsed`;
        const saved = localStorage.getItem(storageKey) === "1";
        setCollapse(btn, body, storageKey, saved);

        btn.addEventListener("click", () => {
          const next = !body.classList.contains("is-collapsed");
          setCollapse(btn, body, storageKey, next);
        });
      });
      return;
    }

    bindCollapseById("tradeToggle", "tradeBody", "kimpview:tradeCollapsed");
    bindCollapseById("liqToggle", "liqBody", "kimpview:liqCollapsed");
  }

  function bindCollapseById(toggleId, bodyId, storageKey) {
    const btn = document.getElementById(toggleId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return;

    const saved = localStorage.getItem(storageKey) === "1";
    setCollapse(btn, body, storageKey, saved);

    btn.addEventListener("click", () => {
      const next = !body.classList.contains("is-collapsed");
      setCollapse(btn, body, storageKey, next);
    });
  }

  function setCollapse(btn, body, storageKey, collapsed) {
    body.classList.toggle("is-collapsed", collapsed);
    btn.classList.toggle("rot", collapsed);
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    localStorage.setItem(storageKey, collapsed ? "1" : "0");
  }

      // ===== API =====
      async function loadCoinsAndRender(initial = false) {
        if (state._isLoading) return;
        state._isLoading = true;

        try {
          const coins = await fetchCoinsFromAPI(state.exchange);
          const list = Array.isArray(coins) ? coins : [];

          const binanceMap = await fetchBinancePricesCached();
          const binanceVolMap = await fetchBinanceVolumesCached();

        for (const c of list) {
          const sym = c.symbol;

          if (sym === "USDT") {
            c.priceUSD = 1;
            c.binanceKRW = (state.fxKRW > 0) ? state.fxKRW : 0;
            c.kimp = null;
            c.kimpDiffKRW = null;
            continue;
          }

          const hasBinance = binanceMap.has(sym);
          const usd = hasBinance ? (Number(binanceMap.get(sym)) || 0) : 0;

          c.priceUSD = usd;
          c.binanceKRW = (usd > 0 && state.fxKRW > 0) ? (usd * state.fxKRW) : 0;

          const volUSDT = hasBinance ? (Number(binanceVolMap.get(sym)) || 0) : 0;
          c.binanceVolKRW = (volUSDT > 0 && state.usdtKRW > 0) ? (volUSDT * state.usdtKRW) : 0;

          if (c.binanceKRW > 0) {
            const krw = Number(c.priceKRW || 0);
            const diff = krw - c.binanceKRW;
            const kimp = ((krw / c.binanceKRW) - 1) * 100;

            if (!Number.isFinite(kimp) || Math.abs(kimp) >= 5) {
              c.kimp = null;
              c.kimpDiffKRW = null;
            } else {
              c.kimp = kimp;
              c.kimpDiffKRW = diff;
            }
          } else {
            c.kimp = null;
            c.kimpDiffKRW = null;
          }

          if (KIMP_EXCLUDE.has(sym)) {
            c.kimp = null;
            c.kimpDiffKRW = null;
          }
        }

      state.coins = list;

      if (initial) {
      }

      render();
    } catch (err) {
      console.warn("[KIMPVIEW] API 로드 실패:", err);
      state.coins = [];
      render();
    } finally {
      state._isLoading = false;
    }
  }

  async function fetchCoinsFromAPI(exchange) {
    exchange = (exchange || "upbit_krw").toLowerCase();

    if (state._aborter) state._aborter.abort();
    state._aborter = new AbortController();
    const signal = state._aborter.signal;

    if (exchange === "upbit_krw") return await fromUpbit(signal);
    if (exchange === "bithumb_krw") return await fromBithumb(signal);

    return await fromUpbit(signal);
  }

  // -------- UPBIT --------
  async function fromUpbit(signal) {
    const markets = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", { signal })
      .then(r => r.json());

    const krw = markets.filter(m => String(m.market || "").startsWith("KRW-"));
    const MAX = 400;

    const MUST = [
      "KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE",
      "KRW-ADA", "KRW-BCH", "KRW-LTC", "KRW-TRX", "KRW-USDT"
    ];

    const marketSet = new Set(krw.map(m => m.market));
    const sorted = [...krw].sort((a, b) => String(a.market).localeCompare(String(b.market)));

    const list = [];
    for (const m of MUST) if (marketSet.has(m)) list.push(m);
    for (const m of sorted) {
      if (list.length >= MAX) break;
      if (list.includes(m.market)) continue;
      list.push(m.market);
    }

    const chunks = chunk(list, 80);
    const tickers = [];
    for (const c of chunks) {
      const t = await fetch(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(c.join(","))}`, { signal })
        .then(r => r.json());
      tickers.push(...t);
    }

    const nameMap = new Map(krw.map(m => [m.market, m.korean_name]));

    return tickers.map(t => {
      const symbol = String(t.market).replace("KRW-", "");
      const priceKRW = Number(t.trade_price || 0);
      const change24h = Number(t.signed_change_rate || 0) * 100;
      const change24hKRW = Number(t.signed_change_price || 0);
      const volKRW = Number(t.acc_trade_price_24h || 0);

      return {
        symbol,
        name: nameMap.get(t.market) || symbol,
        priceKRW,
        priceUSD: 0,
        binanceKRW: 0,
        change24h,
        change24hKRW,
        mcapKRW: 0,
        volKRW,
        kimp: null,
        kimpDiffKRW: null,
      };
    });
  }

  // -------- BITHUMB --------
  async function fromBithumb(signal) {
    const data = await fetch("https://api.bithumb.com/public/ticker/ALL_KRW", { signal })
      .then(r => r.json());

    const obj = data?.data || {};
    const out = [];

    for (const [symbol, v] of Object.entries(obj)) {
      if (symbol === "date") continue;

      out.push({
        symbol,
        name: symbol,
        priceKRW: Number(v?.closing_price || 0),
        priceUSD: 0,
        binanceKRW: 0,
        change24h: Number(v?.fluctate_rate_24H || 0),
        change24hKRW: 0,
        mcapKRW: 0,
        volKRW: Number(v?.acc_trade_value_24H || 0),
        kimp: null,
        kimpDiffKRW: null,
      });
    }
    return out;
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ===== BINANCE (USDT) =====
  async function fetchBinancePricesCached() {
    const now = Date.now();
    if (state._binance.map.size > 0 && (now - state._binance.ts) < state._binance.ttlMs) {
      return state._binance.map;
    }

    const endpoints = [
      "https://data-api.binance.vision/api/v3/ticker/price",
      "https://api.binance.com/api/v3/ticker/price",
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        const data = await res.json();

        const map = new Map();
        for (const item of data) {
          const sym = String(item?.symbol || "");
          if (!sym.endsWith("USDT")) continue;
          const base = sym.slice(0, -4);
          map.set(base, Number(item.price || 0));
        }

        state._binance.map = map;
        state._binance.ts = now;
        return map;
      } catch (e) {
        console.warn("[KIMPVIEW] Binance endpoint 실패:", e);
      }
    }

    return state._binance.map;
  }

  async function fetchBinanceVolumesCached() {
    const now = Date.now();
    if (state._binance24h.map.size > 0 && (now - state._binance24h.ts) < state._binance24h.ttlMs) {
      return state._binance24h.map;
    }

    const endpoints = [
      "https://data-api.binance.vision/api/v3/ticker/24hr",
      "https://api.binance.com/api/v3/ticker/24hr",
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        const data = await res.json();

        const map = new Map();
        for (const item of data) {
          const sym = String(item?.symbol || "");
          if (!sym.endsWith("USDT")) continue;
          const base = sym.slice(0, -4);
          map.set(base, Number(item?.quoteVolume || 0));
        }

        state._binance24h.map = map;
        state._binance24h.ts = now;
        return map;
      } catch (e) {
        console.warn("[KIMPVIEW] Binance 24h endpoint 실패:", e);
      }
    }

    return state._binance24h.map;
  }

  // ===== AUTO REFRESH =====
  function startAutoRefresh(ms) {
    stopAutoRefresh();
    state._refreshTimer = setInterval(() => loadCoinsAndRender(false), ms);
  }

  function stopAutoRefresh() {
    if (state._refreshTimer) clearInterval(state._refreshTimer);
    state._refreshTimer = null;
  }

  // ===== RENDER =====
  function render() {
    const rows = getFilteredSortedCoins();
    coinTableBody.innerHTML = "";

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td colspan="6" style="padding:24px;text-align:center;color:#6b7280;">
          ${state.favOnly
            ? "즐겨찾기한 코인이 없습니다."
            : state.query
              ? "검색 결과가 없습니다."
              : "표시할 데이터가 없습니다."}
        </td>
      `;
      coinTableBody.appendChild(tr);
      syncSortUI();
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach(c => frag.appendChild(renderRow(c)));
    coinTableBody.appendChild(frag);
    syncSortUI();
  }

  function getPriceDirection(symbol, currentPrice) {
    const prev = prevPriceMap.get(symbol);
    prevPriceMap.set(symbol, currentPrice);
    if (prev == null) return "";
    if (currentPrice > prev) return "price-flash-up";
    if (currentPrice < prev) return "price-flash-down";
    return "";
  }

  function renderRow(c) {
    const tr = document.createElement("tr");
    tr.dataset.symbol = c.symbol;

    const isFav = state.favorites.has(c.symbol);
    const starSvg = getStarSvg(isFav);
    const chgClass = Number(c.change24h) >= 0 ? "plus" : "minus";
    const kimpClass = (c.kimp == null || Number(c.kimp) >= 0) ? "plus" : "minus";

    const dirClass = getPriceDirection(c.symbol, Number(c.priceKRW || 0));

    tr.innerHTML = `
      <td class="td-left">
        <div class="assetCell">
          <img class="assetIconImg"
            src="https://cryptoicons.org/api/icon/${String(c.symbol || "").toLowerCase()}/64"
            alt="${escapeHtml(c.symbol)}"
            onerror="this.onerror=null; this.src='images/coins/default.png';">
          <div class="assetText">
            <div class="assetName">${escapeHtml(c.name)}</div>
            <div class="assetSub">
              <button class="favBtn ${isFav ? "active" : ""}" type="button" aria-label="즐겨찾기">${starSvg}</button>
              <span class="assetSym">${escapeHtml(c.symbol)}</span>
              <span class="chartMini" aria-hidden="true"></span>
            </div>
          </div>
        </div>
      </td>

      <td class="td-right priceStack ${dirClass}">
        <div class="priceMain">${formatKRW(c.priceKRW)}</div>
        <span class="priceSub">${formatKRW(c.binanceKRW)}</span>
      </td>

      <td class="td-right changeStack">
        <div class="chgMain change ${chgClass}">${formatPct(c.change24h)}</div>
        <div class="chgSub">${formatDeltaKRW(c.change24hKRW)}</div>
      </td>

      <td class="td-right volStack col-hide-980">
        <div class="volMain">${formatKRWCompact(c.volKRW)}</div>
        <div class="volSub">${formatKRWCompact(c.binanceVolKRW)}</div>
      </td>

      <td class="td-right priceStrong col-hide-980">${formatKRWCompact(c.mcapKRW)}</td>

      <td class="td-right change ${kimpClass}">
        ${formatPct(c.kimp)}
        ${renderKimpDiff(c.kimpDiffKRW)}
      </td>
    `;

    const el = tr.querySelector(".priceStack");
    if (el && dirClass) setTimeout(() => el.classList.remove("price-flash-up", "price-flash-down"), 800);

    tr.querySelector(".favBtn")?.addEventListener("click", () => toggleFavorite(c.symbol));

    const chartIcon = tr.querySelector(".chartMini");
    if (chartIcon) {
      chartIcon.title = "CoinMarketCap 차트 보기";
      chartIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        window.open(getCoinMarketCapUrl(c.symbol), "_blank");
      });
    }

    return tr;
  }

  // ===== FILTER / SORT =====
  function getFilteredSortedCoins() {
    let list = [...state.coins];

    const q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        c =>
          String(c.symbol || "").toLowerCase().includes(q) ||
          String(c.name || "").toLowerCase().includes(q)
      );
    }

    if (state.favOnly) list = list.filter(c => state.favorites.has(c.symbol));

    list.sort((a, b) => {
      const af = state.favorites.has(a.symbol);
      const bf = state.favorites.has(b.symbol);
      if (af !== bf) return af ? -1 : 1;
      return compare(a, b, state.sortKey, state.sortDir);
    });

    return list;
  }

  function compare(a, b, key, dir) {
    const av = a?.[key];
    const bv = b?.[key];

    let res = 0;
    if (typeof av === "string" || typeof bv === "string") {
      res = String(av ?? "").localeCompare(String(bv ?? ""));
    } else {
      res = Number(av ?? 0) - Number(bv ?? 0);
    }

    return dir === "asc" ? res : -res;
  }

  function syncSortUI() {
    sortableThs.forEach(th => {
      const key = th.dataset.sort;
      th.dataset.dir = (key === state.sortKey && state._sortedOnce) ? state.sortDir : "";
    });
  }

  // ===== EVENTS =====
  function bindEvents() {
    exchangeSelect?.addEventListener("change", () => {
      state.exchange = exchangeSelect.value;
      loadCoinsAndRender(false);
    });

    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        state.query = searchInput.value;
        toggleClearBtn();
        render();
      }
    });

    applyBtn?.addEventListener("click", () => {
      state.query = searchInput?.value || "";
      toggleClearBtn();
      render();
    });

    clearSearchBtn?.addEventListener("click", () => {
      state.query = "";
      if (searchInput) searchInput.value = "";
      toggleClearBtn();
      render();
    });

    favoriteOnlyInline?.addEventListener("change", () => {
      state.favOnly = favoriteOnlyInline.checked;
      render();
    });

    sortableThs.forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (!key) return;

        state._sortedOnce = true;

        if (state.sortKey === key) state.sortDir = (state.sortDir === "asc") ? "desc" : "asc";
        else {
          state.sortKey = key;
          state.sortDir = "desc";
        }
        render();
      });
    });
  }

  // ===== FAVORITES =====
  function loadFavorites() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    localStorage.setItem(LS_KEY, JSON.stringify([...state.favorites]));
  }

  function toggleFavorite(symbol) {
    if (state.favorites.has(symbol)) state.favorites.delete(symbol);
    else state.favorites.add(symbol);
    saveFavorites();
    render();
  }

  // ===== FORMAT =====
  function renderKimpDiff(diff) {
    if (diff == null || Number.isNaN(Number(diff))) return "";
    const v = Number(diff);
    if (!Number.isFinite(v) || v === 0) return '<small class="kimpSub">0원</small>';
    return `<small class="kimpSub">${formatKRWDiff(v)}</small>`;
  }

  function formatKRWDiff(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "0";

  const sign = v > 0 ? "+" : "-";
  const abs = Math.abs(v);

  let s;

  if (abs < 0.01) {
    s = abs.toFixed(4);          
  }
  else if (abs < 1) {
    s = abs.toFixed(2);          
  }
  else if (abs < 100) {
    s = abs.toFixed(2);          
  }
  else {
    s = Math.floor(abs).toLocaleString("ko-KR"); // 1,234
  }

  s = s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  if (s.includes(".")) {
    const [i, d] = s.split(".");
    s = Number(i).toLocaleString("ko-KR") + "." + d;
  }
  return sign + s;
  }

  function formatKRW(n) {
    const v = Number(n || 0);
    if (!v) return "";

    if (v < 100) {
      let digits = 2;
      if (v < 1) digits = 4;
      else if (v < 10) digits = 3;

      return "₩" + v.toLocaleString("ko-KR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }

    return "₩" + Math.floor(v).toLocaleString("ko-KR");
  }

  function formatPct(n) {
  if (n == null || Number.isNaN(Number(n))) return "";

  const v = Number(n);
  const sign = v > 0 ? "+" : "";

  return sign + v.toFixed(2) + "%";
  }

  function formatDeltaKRW(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "-";
    if (v === 0) return "0";

    const sign = v > 0 ? "+" : "-";
    const abs = Math.abs(v);

    if (Number.isInteger(abs)) return sign + abs.toLocaleString("ko-KR");

    let s = abs
      .toFixed(3)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1");

    return sign + s;
  }

  function formatKRWCompact(n) {
    const v = Number(n || 0);
    if (!v) return "";

    const ONE_EOK = 100_000_000;
    const TEN_M = 10_000_000;
    const ONE_JO = 1_000_000_000_000;

    if (v >= ONE_JO) {
      const jo = Math.floor(v / ONE_JO);
      const eok = Math.floor((v % ONE_JO) / ONE_EOK);
      return eok > 0
        ? `${jo.toLocaleString("ko-KR")}조 ${eok.toLocaleString("ko-KR")}억`
        : `${jo.toLocaleString("ko-KR")}조`;
    }

    if (v >= ONE_EOK) {
      const eok = Math.floor(v / ONE_EOK);
      return `${eok.toLocaleString("ko-KR")}억`;
    }

    const tenMillion = Math.floor(v / TEN_M) * TEN_M;
    if (tenMillion <= 0) return "0";
    return `${Math.floor(tenMillion / TEN_M).toLocaleString("ko-KR")}천만`;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  // ===== ICONS =====
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

  // ===== COINMARKETCAP LINK =====
  function getCoinMarketCapUrl(symbol) {
    const sym = String(symbol || "").toUpperCase();
    const SLUG = {
      BTC: "bitcoin",
      ETH: "ethereum",
      XRP: "xrp",
      SOL: "solana",
      DOGE: "dogecoin",
      ADA: "cardano",
      TRX: "tron",
      LTC: "litecoin",
      BCH: "bitcoin-cash",
      USDT: "tether",
    };

    const slug = SLUG[sym];
    if (slug) return `https://coinmarketcap.com/ko/currencies/${slug}/`;
    return `https://coinmarketcap.com/ko/search/?q=${encodeURIComponent(sym)}`;
  }

  function toggleClearBtn() {
    if (!clearSearchBtn) return;
    clearSearchBtn.style.display = state.query.trim() !== "" ? "inline-block" : "none";
  }

  // ===== TOP METRICS =====
  async function loadTopMetrics() {
    if (state._topMetricsLoading) return;
    state._topMetricsLoading = true;

    try {
      const geo = await fetch("https://api.coingecko.com/api/v3/global", { cache: "no-store" })
        .then(r => r.json());

      let krwRate = Number(state.fxKRW || 0);

      const fxSources = [
        { url: "https://open.er-api.com/v6/latest/USD", pick: (j) => Number(j?.rates?.KRW ?? 0) },
        { url: "https://api.frankfurter.app/latest?from=USD&to=KRW", pick: (j) => Number(j?.rates?.KRW ?? 0) },
      ];

      for (const s of fxSources) {
        try {
          const j = await fetch(s.url, { cache: "no-store" }).then(r => r.json());
          const next = s.pick(j);
          if (next > 1000 && next < 3000) {
            krwRate = next;
            state.fxKRW = next;
            break;
          }
        } catch { }
      }

      const usdt = await fetch("https://api.upbit.com/v1/ticker?markets=KRW-USDT", { cache: "no-store" })
        .then(r => r.json());
      const usdtKRW = Number(usdt?.[0]?.trade_price ?? 0);

      state.fxKRW = krwRate;
      state.usdtKRW = usdtKRW;
      window.__USDT_KRW = usdtKRW;

      const $fx = document.getElementById("fxKRW");
      const $usdt = document.getElementById("usdtKRW");
      const $dom = document.getElementById("btcDominance");
      const $mcap = document.getElementById("totalMcap");
      const $vol = document.getElementById("totalVolume");
      const $cb = document.getElementById("cbPremium");

      if ($fx) {
        $fx.textContent = krwRate ? `${krwRate.toLocaleString("ko-KR")}원` : "-";
        $fx.title = "환율(USD→KRW) · 표시 기준: Google";
      }

      if ($usdt) {
        $usdt.textContent = usdtKRW ? (usdtKRW.toLocaleString("ko-KR") + "원") : "-";
        $usdt.title = "테더(USDT) · 기준: Upbit(KRW-USDT)";
      }

      const dom = geo?.data?.market_cap_percentage?.btc ?? null;
      if ($dom) {
        $dom.textContent = (dom == null) ? "-" : (Number(dom).toFixed(2) + "%");
        $dom.title = "도미넌스 · 기준: TradingView(BTC.D)";
        $dom.style.cursor = "pointer";

        if (!$dom.dataset.bound) {
          $dom.dataset.bound = "1";
          $dom.addEventListener("click", () => {
            window.open("https://kr.tradingview.com/chart/?symbol=CRYPTOCAP%3ABTC.D", "_blank");
          });
        }
      }

      const mcapKrw = geo?.data?.total_market_cap?.krw ?? 0;
      const volKrw = geo?.data?.total_volume?.krw ?? 0;
      if ($mcap) {
        $mcap.textContent = mcapKrw ? formatKRWCompact(mcapKrw) : "-";
        $mcap.title = "시가총액 · 전세계 총합(CoinGecko Global)";
      }
      if ($vol) {
        $vol.textContent = volKrw ? formatKRWCompact(volKrw) : "-";
        $vol.title = "24시간 거래량 · 전세계 총합(CoinGecko Global)";
      }

      let cbPremPct = null;
      try {
        const [binanceMap, cbJson] = await Promise.all([
          fetchBinancePricesCached(),
          fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { cache: "no-store" }).then(r => r.json()),
        ]);

        const binanceBtcUsd = Number(binanceMap.get("BTC") || 0);
        const coinbaseBtcUsd = Number(cbJson?.data?.amount || 0);

        if (binanceBtcUsd > 0 && coinbaseBtcUsd > 0) {
          cbPremPct = ((coinbaseBtcUsd - binanceBtcUsd) / binanceBtcUsd) * 100;
        }
      } catch { }

      if ($cb) {
        $cb.textContent = (cbPremPct == null)
          ? "-"
          : ((cbPremPct >= 0 ? "+" : "") + cbPremPct.toFixed(2) + "%");
        $cb.title = "코인베이스 프리미엄 · 기준: TradingView";
      }

      if (state.coins.length > 0) {
        const fx2 = Number(state.fxKRW || 0);
        for (const c of state.coins) {
          const usd = Number(c.priceUSD || 0);
          c.binanceKRW = (usd > 0 && fx2 > 0) ? (usd * fx2) : 0;
          c.kimpDiffKRW = (c.binanceKRW > 0) ? (Number(c.priceKRW || 0) - c.binanceKRW) : null;
          c.kimp = (c.binanceKRW > 0)
            ? ((Number(c.priceKRW || 0) / c.binanceKRW) - 1) * 100
            : null;
        
        if (KIMP_EXCLUDE.has(c.symbol)) {
          c.kimp = null;
          c.kimpDiffKRW = null;
        }
}
        render();
      }
    } catch (e) {
      console.warn("[KIMPVIEW] TopMetrics API 실패", e);
    } finally {
      state._topMetricsLoading = false;
    }
  }

  // ===== MARKET STATUS =====
  async function loadMarketStatus() {
    if (!$longRate || !$shortRate || !$fearGreed) return;

    try {
      const url = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d&limit=1";
      const arr = await fetch(url, { cache: "no-store" }).then(r => r.json());

      const d = Array.isArray(arr) ? arr[0] : null;
      const longAcc = Number(d?.longAccount ?? NaN);
      const shortAcc = Number(d?.shortAccount ?? NaN);

      if (Number.isFinite(longAcc) && Number.isFinite(shortAcc) && (longAcc + shortAcc) > 0) {
        $longRate.textContent = (longAcc * 100).toFixed(2) + "%";
        $shortRate.textContent = (shortAcc * 100).toFixed(2) + "%";
      } else {
        $longRate.textContent = "-";
        $shortRate.textContent = "-";
      }
    } catch {
      $longRate.textContent = "-";
      $shortRate.textContent = "-";
    }

    try {
      const j = await fetch("https://api.alternative.me/fng/?limit=1", { cache: "no-store" }).then(r => r.json());
      const v = Number(j?.data?.[0]?.value ?? NaN);
      const clsName = String(j?.data?.[0]?.value_classification ?? "").trim();

      if (Number.isFinite(v)) {
        $fearGreed.textContent = `${Math.round(v)} (${clsName})`;
        $fearGreed.classList.remove("fear-low", "fear-mid", "fear-high");
        if (v < 40) $fearGreed.classList.add("fear-low");
        else if (v < 60) $fearGreed.classList.add("fear-mid");
        else $fearGreed.classList.add("fear-high");
      } else {
        $fearGreed.textContent = "-";
      }
    } catch {
      $fearGreed.textContent = "-";
    }
  }

  loadMarketStatus();
  setInterval(loadMarketStatus, 60_000);

  // ===== ALERT / WS =====
  function pad2(n) { return String(n).padStart(2, "0"); }
  function nowTime() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatKoreanMoneyKRW(amount) {
    if (!amount) return "";
    if (amount >= 1e8) return (amount / 1e8).toFixed(2) + "억";
    if (amount >= 1e4) return (amount / 1e4).toFixed(0) + "만";
    return Math.round(amount).toLocaleString("ko-KR");
  }

  function toKrwByUsdt(usdLike) {
    const rate = Number(window.__USDT_KRW || state.usdtKRW || state.fxKRW || 0);
    if (!rate || !Number.isFinite(rate)) return 0;
    return usdLike * rate;
  }

  const ALERT_SYMBOLS = ["BTC","ETH","XRP","SOL","DOGE","BNB","SUI","ADA","BCH","TRX","LTC"];

  const TRADE_MIN_KRW = 80_000_000;
  const LIQ_MIN_KRW = 100_000;
  const COOLDOWN_MS = 1500;

  const lastHitTrade = new Map();
  const lastHitLiq = new Map();

  function passCooldown(map, sym) {
    const now = Date.now();
    const prev = map.get(sym) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    map.set(sym, now);
    return true;
  }

  let wsFutures = null;
  let wsRetry = 0;

  function connectFuturesWS() {
    if (wsFutures) {
      try { wsFutures.close(); } catch {}
      wsFutures = null;
    }

    const streamList = [];
    for (const s of ALERT_SYMBOLS) {
      const base = `${s.toLowerCase()}usdt`;
      streamList.push(`${base}@trade`);
      streamList.push(`${base}@forceOrder`);
    }

    wsFutures = new WebSocket(`wss://fstream.binance.com/stream?streams=${streamList.join("/")}`);

    wsFutures.onopen = () => {
      wsRetry = 0;
      sideState.tradeRows = Array.from({ length: 10 }, makeEmptyRow);
      sideState.liqRows = Array.from({ length: 10 }, makeEmptyRow);
      renderTrade();
      renderLiq();
      console.log("[KIMPVIEW] Futures WS connected");
    };

    wsFutures.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const data = msg?.data;
      if (!data) return;

      if (data.e === "trade") {
        const sym = String(data.s || "").replace("USDT", "");
        const priceUSDT = Number(data.p || 0);
        const qty = Number(data.q || 0);
        if (!priceUSDT || !qty) return;

        const type = data.m ? "숏" : "롱";
        const priceUSD = priceUSDT;
        const amountKRW = toKrwByUsdt(priceUSDT * qty);

        if (!priceUSD || !amountKRW) return;
        if (amountKRW < TRADE_MIN_KRW) return;
        if (!passCooldown(lastHitTrade, sym)) return;

        pushTradeRow({ sym, type, amountKRW, priceUSD });
      }

      if (data.e === "forceOrder") {
        const o = data.o || {};
        const sym = String(o.s || "").replace("USDT", "");
        const side = String(o.S || ""); // BUY / SELL

        const qty = Number(o.z || o.l || o.q || 0);
        const priceUSDT = Number(o.ap || o.p || 0);
        if (!priceUSDT || !qty) return;

        const liqType = (side === "SELL") ? "롱 청산" : "숏 청산";

        const priceUSD = priceUSDT;
        const amountKRW = toKrwByUsdt(priceUSDT * qty);

        if (!priceUSD || !amountKRW) return;
        if (amountKRW < LIQ_MIN_KRW) return;
        if (!passCooldown(lastHitLiq, sym)) return;

        pushLiqRow({ sym, liqType, amountKRW, priceUSD });
      }
    };

    wsFutures.onerror = () => {
      console.warn("[KIMPVIEW] Futures WS error");
    };

    wsFutures.onclose = () => {
      const wait = Math.min(10_000, 800 * Math.pow(1.6, wsRetry++));
      console.warn(`[KIMPVIEW] Futures WS closed. retry in ${Math.round(wait)}ms`);
      setTimeout(connectFuturesWS, wait);
    };
  }

  connectFuturesWS();

})();
