(() => {
  const UPBIT_PROXY = "https://kimpview-proxy.cjstn3391.workers.dev/upbit";
  const BITHUMB_PROXY = "https://kimpview-proxy.cjstn3391.workers.dev/bithumb";

  const exchangeSelect = document.getElementById("exchangeSelect");
  const searchInput = document.getElementById("searchInput");
  const applyBtn = document.getElementById("applyBtn");
  const favoriteOnlyInline = document.getElementById("favoriteOnlyInline");
  const coinTableBody = document.getElementById("coinTableBody");
  const tableSpinner = document.getElementById("tableSpinner");
  const tableWrapEl = document.querySelector(".tableWrap");
  const sortableThs = document.querySelectorAll("th.sortable[data-sort]");
  const clearSearchBtn = document.getElementById("clearSearchBtn");
  const imageLoadFailures = new Set();

  if (!coinTableBody) {
    console.warn("[KIMPVIEW] #coinTableBody 없음. HTML id 확인!");
    return;
  }

  const APP_VERSION = "2026.02.11-coinpage-v1";
  const VERSION_KEY = "kimpview:appVersion";

  function clearStorageByPrefix(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      for (const k of keys) {
        try {
          localStorage.removeItem(k);
        } catch {}
      }
    } catch {}
  }

  function migrateStorageIfNeeded() {
    try {
      const prev = localStorage.getItem(VERSION_KEY);
      if (prev !== APP_VERSION) {
        clearStorageByPrefix("kimpview:tableCache:");
        localStorage.removeItem("kimpview:capsCache:v1");
        localStorage.removeItem("kimpview:topmetricsCache:v1");
        localStorage.setItem(VERSION_KEY, APP_VERSION);
      }
    } catch {}
  }

  migrateStorageIfNeeded();

  function showSpinner() {
    if (tableSpinner) tableSpinner.style.display = "flex";
    if (tableWrapEl) tableWrapEl.style.visibility = "hidden";
  }

  function hideSpinner() {
    if (tableSpinner) tableSpinner.style.display = "none";
    if (tableWrapEl) tableWrapEl.style.visibility = "visible";
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function makeTimeoutSignal(ms) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  }

  async function safeFetchJson(url, { signal, timeoutMs = 8000, label = "API", retries = 2 } = {}) {
    const timeoutSignal = signal || makeTimeoutSignal(timeoutMs);
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let res;
      try {
        res = await fetch(url, { signal: timeoutSignal, cache: "no-store" });
      } catch (e) {
        lastErr = e;
        await sleep(200 * (attempt + 1));
        continue;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const text = await res.text();

      if (!res.ok) {
        if ((res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < retries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      if (!ct.includes("application/json")) {
        if (attempt < retries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw new Error("Not JSON");
      }

      try {
        return JSON.parse(text);
      } catch (e) {
        if (attempt < retries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }

    throw lastErr || new Error("fetch failed");
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(id);
    }
  }

  function formatKRW(n) {
    const v = Number(n || 0);
    if (!v) return "";
    let digits = 0;
    if (v >= 100) digits = 0;
    else if (v < 0.001) digits = 10;
    else if (v < 1) digits = 6;
    else digits = 2;

    return "₩" + v.toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: true
    });
  }

  function formatPct(n) {
    if (n == null || Number.isNaN(Number(n))) return "";
    const v = Number(n);
    if (Math.abs(v) < 0.005) return "0.00%";
    const sign = v > 0 ? "+" : "";
    return sign + v.toFixed(2) + "%";
  }

  function formatDeltaKRW(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return "";

    const absV = Math.abs(v);
    const sign = v > 0 ? "+" : "-";

    let digits = 0;
    if (absV < 0.0001) digits = 10;
    else if (absV < 1) digits = 7;
    else if (absV < 100) digits = 2;
    else digits = 0;

    const formatted = absV.toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });

    return sign + formatted.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  }

  function formatKRWDiff(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return "";

    const sign = v > 0 ? "+" : "-";
    const abs = Math.abs(v);

    let s;
    if (abs < 1) s = abs.toFixed(6);
    else if (abs < 100) s = abs.toFixed(2);
    else s = Math.floor(abs).toLocaleString("ko-KR");

    s = s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");

    if (s.includes(".") && abs >= 1) {
      const [i, d] = s.split(".");
      s = Number(i).toLocaleString("ko-KR") + "." + d;
    }

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
      return eok > 0 ? `${jo.toLocaleString("ko-KR")}조 ${eok.toLocaleString("ko-KR")}억` : `${jo.toLocaleString("ko-KR")}조`;
    }

    if (v >= ONE_EOK) {
      const eok = Math.floor(v / ONE_EOK);
      return `${eok.toLocaleString("ko-KR")}억`;
    }

    const tenMillion = Math.floor(v / TEN_M) * TEN_M;
    if (tenMillion <= 0) return "";
    return `${Math.floor(tenMillion / TEN_M).toLocaleString("ko-KR")}천만`;
  }

  function formatMcapKRW(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v === 0) return "";

    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
    if (abs >= 1e8) return `${Math.floor(v / 1e8).toLocaleString("ko-KR")}억`;
    if (abs >= 1e4) return `${Math.floor(v / 1e4).toLocaleString("ko-KR")}만`;
    return `${Math.floor(v).toLocaleString("ko-KR")}원`;
  }

  function formatMcapUSD(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v === 0) return "";
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${Math.floor(v).toLocaleString("en-US")}`;
  }

  function renderKimpDiff(diff) {
    if (diff == null || Number.isNaN(Number(diff))) return "";
    const v = Number(diff);
    if (!Number.isFinite(v) || v === 0) return "";
    return `<span class="kimpSub smallkimpsub">${formatKRWDiff(v)}</span>`;
  }

  function parseNumberFromText(text) {
    const s = String(text ?? "").replace(/[^\d.]/g, "");
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  const LS_KEY = "kimpview:favorites";

  const state = {
    exchange: exchangeSelect?.value || "upbit_krw",
    query: "",
    favOnly: false,
    sortKey: "volKRW",
    sortDir: "desc",
    _sortedOnce: false,
    favorites: loadFavorites(),
    coins: [],
    _coinCaps: new Map(),
    _coinCapsTs: 0,
    _refreshTimer: null,
    _aborter: null,
    _isLoading: false,
    fxKRW: 0,
    usdtKRW: 0,
    btcDom: 0,
    _inlineCharts: [],
    _binance: { map: new Map(), ts: 0, ttlMs: 3000 },
    _binance24h: { map: new Map(), ts: 0, ttlMs: 3000 },
    _binanceActive: { set: new Set(), ts: 0, ttlMs: 60_000 },
    _pendingReload: false,
  };

  const prevPriceMap = new Map();
  const visibleSymbols = new Set();
  state._ioReady = false;

  const rowObserver = ("IntersectionObserver" in window)
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          const sym = e?.target?.dataset?.symbol;
          if (!sym) continue;
          if (e.isIntersecting) visibleSymbols.add(sym);
          else visibleSymbols.delete(sym);
        }
        state._ioReady = true;
      }, { root: null, threshold: 0.01 })
    : null;

  function observeRow(tr) {
    if (!rowObserver || !tr) return;
    rowObserver.observe(tr);
  }

  function resetRowObserver() {
    if (!rowObserver) return;
    rowObserver.disconnect();
    visibleSymbols.clear();
    state._ioReady = false;
  }

  const UPBIT_MARKETS_LS = "kimpview:upbitMarketsKRW";
  const UPBIT_MARKETS_TTL_MS = 6 * 60 * 60 * 1000;
  let upbitMarketsCache = null;

  function loadUpbitMarketsFromLS() {
    try {
      const raw = localStorage.getItem(UPBIT_MARKETS_LS);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.ts || !obj.data) return null;
      if ((Date.now() - Number(obj.ts)) > UPBIT_MARKETS_TTL_MS) return null;
      return { ts: Number(obj.ts), marketsJson: obj.data };
    } catch {
      return null;
    }
  }

  function saveUpbitMarketsToLS(marketsJson) {
    try {
      localStorage.setItem(UPBIT_MARKETS_LS, JSON.stringify({ ts: Date.now(), data: marketsJson }));
    } catch {}
  }

  const LS_TABLE_PREFIX = "kimpview:tableCache:v1:";
  const TABLE_TTL_MS = 10 * 1000;

  function tableCacheKey(exchange) {
    return LS_TABLE_PREFIX + String(exchange || "upbit_krw").toLowerCase();
  }

  function loadTableCache(exchange) {
    try {
      const raw = localStorage.getItem(tableCacheKey(exchange));
      if (!raw) return null;

      const obj = JSON.parse(raw);
      const ts = Number(obj?.ts || 0);
      const list = obj?.coins;

      if (!ts || !Array.isArray(list)) return null;
      if ((Date.now() - ts) > TABLE_TTL_MS) return null;

      return list;
    } catch {
      return null;
    }
  }

  function saveTableCache(exchange, coins) {
    try {
      localStorage.setItem(
        tableCacheKey(exchange),
        JSON.stringify({ ts: Date.now(), exchange: String(exchange || ""), coins })
      );
    } catch {}
  }

  function restoreTableFromCache(exchange) {
    const cached = loadTableCache(exchange);
    if (!cached || cached.length === 0) return false;
    state.coins = cached;
    return true;
  }

  const LS_TOPMETRICS = "kimpview:topmetricsCache:v1";

  function saveTopMetricsToLS() {
    try {
      localStorage.setItem(
        LS_TOPMETRICS,
        JSON.stringify({
          ts: Date.now(),
          fxKRW: Number(state.fxKRW || 0),
          usdtKRW: Number(state.usdtKRW || 0),
          btcDom: Number(state.btcDom || 0),
        })
      );
    } catch {}
  }

  function restoreTopMetricsFromLS() {
    try {
      const raw = localStorage.getItem(LS_TOPMETRICS);
      if (!raw) return;
      const obj = JSON.parse(raw) || {};
      const fx = Number(obj.fxKRW || 0);
      const usdt = Number(obj.usdtKRW || 0);
      const dom = Number(obj.btcDom || 0);

      if (Number.isFinite(fx) && fx > 0) state.fxKRW = fx;
      if (Number.isFinite(usdt) && usdt > 0) state.usdtKRW = usdt;
      if (Number.isFinite(dom) && dom > 0) state.btcDom = dom;

      const fxEl = document.getElementById("fxKRW");
      const usdtEl = document.getElementById("usdtKRW");
      const domEl = document.getElementById("btcDominance");

      if (fxEl && fx > 0 && (!fxEl.textContent || fxEl.textContent === "-")) fxEl.textContent = `${fx.toLocaleString("ko-KR")}원`;
      if (usdtEl && usdt > 0 && (!usdtEl.textContent || usdtEl.textContent === "-")) usdtEl.textContent = `${Math.round(usdt).toLocaleString("ko-KR")}원`;
      if (domEl && dom > 0 && (!domEl.textContent || domEl.textContent === "-")) domEl.textContent = `${dom.toFixed(2)}%`;
    } catch {}
  }

  function syncTopMetricsCacheFromDOM() {
    const fxEl = document.getElementById("fxKRW");
    const usdtEl = document.getElementById("usdtKRW");

    const fx = fxEl ? parseNumberFromText(fxEl.textContent) : 0;
    const usdt = usdtEl ? parseNumberFromText(usdtEl.textContent) : 0;

    if (fx > 1000 && fx < 3000) state.fxKRW = fx;
    if (usdt > 500 && usdt < 5000) state.usdtKRW = usdt;

    if (state.usdtKRW > 0) window.__USDT_KRW = state.usdtKRW;
    else if (state.fxKRW > 0) window.__USDT_KRW = state.fxKRW;
  }

  function startUnifiedTopMetrics() {
    const loader = window.KIMPVIEW?.loadTopMetrics;

    const runOnce = () => {
      if (typeof loader === "function") {
        Promise.resolve(loader())
          .catch(() => {})
          .finally(() => syncTopMetricsCacheFromDOM());
      } else {
        syncTopMetricsCacheFromDOM();
      }
      saveTopMetricsToLS();
    };

    runOnce();
    setInterval(runOnce, 60_000);
  }

  async function fetchBinanceActiveUsdtBasesCached() {
    const now = Date.now();
    if (state._binanceActive.set.size > 0 && (now - state._binanceActive.ts) < state._binanceActive.ttlMs) {
      return state._binanceActive.set;
    }

    try {
      const data = await safeFetchJson("https://api.binance.com/api/v3/exchangeInfo", {
        timeoutMs: 12000,
        label: "BINANCE exchangeInfo",
        retries: 1,
      });

      const set = new Set();
      const symbols = Array.isArray(data?.symbols) ? data.symbols : [];

      for (const s of symbols) {
        if (s?.quoteAsset === "USDT" && s?.status === "TRADING" && typeof s?.baseAsset === "string") {
          set.add(s.baseAsset.toUpperCase());
        }
      }

      state._binanceActive.set = set;
      state._binanceActive.ts = now;
      return set;
    } catch {
      return state._binanceActive.set;
    }
  }

  const SYMBOL_ALIAS = new Map([["BTT", "BTTC"]]);

  function toBinanceBase(sym) {
    return SYMBOL_ALIAS.get(sym) || sym;
  }

  function normalizeBaseSym(sym) {
    return String(sym || "")
      .toUpperCase()
      .trim()
      .replace(/^KRW-/, "")
      .replace(/^USDT-/, "")
      .replace(/-USDT$/, "");
  }

  function pickTradingViewSymbol(coin) {
    const base = normalizeBaseSym(coin?.symbol);
    if (coin?.hasBinance) return `BINANCE:${base}USDT`;
    const ex = String(state.exchange || "").toLowerCase();
    if (ex.includes("bithumb")) return `BITHUMB:${base}KRW`;
    return `UPBIT:${base}KRW`;
  }

  async function fetchAllMarketCaps() {
    const CAPS_LS_KEY = "kimpview:capsCache:v1";
    const CAPS_TTL_MS = 12 * 60 * 60 * 1000;

    function loadCapsFromLS() {
      try {
        const raw = localStorage.getItem(CAPS_LS_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.ts || !obj.data) return null;
        if (Date.now() - Number(obj.ts) > CAPS_TTL_MS) return null;
        return obj.data;
      } catch {
        return null;
      }
    }

    function saveCapsToLS(data) {
      try {
        localStorage.setItem(CAPS_LS_KEY, JSON.stringify({ ts: Date.now(), data }));
      } catch {}
    }

    const now = Date.now();

    if (state._coinCaps instanceof Map && state._coinCaps.size > 0 && state._coinCapsTs > 0) {
      if ((now - state._coinCapsTs) < CAPS_TTL_MS) return state._coinCaps;
    }

    const ls = loadCapsFromLS();
    if (ls && typeof ls === "object" && !Array.isArray(ls)) {
      state._coinCaps = new Map(Object.entries(ls));
      state._coinCapsTs = now;
      return state._coinCaps;
    }

    const WORKER_URL = "https://kimpview-proxy.cjstn3391.workers.dev/coinpaprika-caps";
    const data = await safeFetchJson(WORKER_URL, { label: "Caps" });

    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Caps payload invalid");

    state._coinCaps = new Map(Object.entries(data));
    state._coinCapsTs = now;
    saveCapsToLS(data);
    return state._coinCaps;
  }

  async function getUpbitMarkets(signal) {
    if (upbitMarketsCache && (Date.now() - upbitMarketsCache.ts) < UPBIT_MARKETS_TTL_MS) {
      return upbitMarketsCache.marketsJson;
    }

    const lsCache = loadUpbitMarketsFromLS();
    if (lsCache) {
      upbitMarketsCache = { ts: lsCache.ts, marketsJson: lsCache.marketsJson };
      return lsCache.marketsJson;
    }

    const marketsJson = await safeFetchJson(`${UPBIT_PROXY}/v1/market/all?isDetails=false`, {
      signal,
      timeoutMs: 12000,
      label: "UPBIT markets",
      retries: 2,
    });

    upbitMarketsCache = { ts: Date.now(), marketsJson };
    saveUpbitMarketsToLS(marketsJson);
    return marketsJson;
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function fromUpbit(signal) {
    try {
      const marketsJson = await getUpbitMarkets(signal);
      const markets = Array.isArray(marketsJson) ? marketsJson : [];
      const krw = markets.filter(m => String(m.market || "").startsWith("KRW-"));

      const cached = loadTableCache(state.exchange);
      const hasCache = !!(cached && cached.length > 0);
      const MAX = hasCache ? 400 : 120;

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

      const chunks = chunk(list, 60);
      const tickers = [];

      for (const c of chunks) {
        const url = `${UPBIT_PROXY}/v1/ticker?markets=${encodeURIComponent(c.join(","))}`;
        const tJson = await safeFetchJson(url, { signal, timeoutMs: 8000, label: "UPBIT ticker", retries: 2 });
        const t = Array.isArray(tJson) ? tJson : [];
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
          exchange: "upbit",
          priceKRW,
          priceUSD: 0,
          binanceKRW: 0,
          change24h,
          change24hKRW,
          mcapKRW: 0,
          volKRW,
          binanceVolKRW: 0,
          kimp: null,
          kimpDiffKRW: null,
          hasBinance: false,
        };
      });
    } catch {
      return [];
    }
  }

  let bithumbNameMap = null;

  async function fromBithumb(signal) {
    try {
      if (!bithumbNameMap) {
        const marketRes = await safeFetchJson(`${BITHUMB_PROXY}/v1/market/all`, {
          signal,
          timeoutMs: 8000,
          label: "BITHUMB market/all",
          retries: 2,
        });

        bithumbNameMap = {};
        (Array.isArray(marketRes) ? marketRes : []).forEach((item) => {
          const [market, symbol] = String(item.market || "").split("-");
          if (market === "KRW") bithumbNameMap[symbol] = item.korean_name;
        });
      }

      const data = await safeFetchJson(`${BITHUMB_PROXY}/public/ticker/ALL_KRW`, {
        signal,
        timeoutMs: 8000,
        label: "BITHUMB ticker/ALL_KRW",
        retries: 2,
      });

      const obj = data?.data || {};
      const out = [];

      for (const [symbol, v] of Object.entries(obj)) {
        if (symbol === "date") continue;

        const price = Number(v?.closing_price || 0);
        const prevClose = Number(v?.prev_closing_price || 0);
        const changeKRW = (price && prevClose) ? (price - prevClose) : 0;

        out.push({
          symbol,
          name: bithumbNameMap?.[symbol] || symbol,
          exchange: "bithumb",
          priceKRW: price,
          priceUSD: 0,
          binanceKRW: 0,
          change24h: Number(v?.fluctate_rate_24H || 0),
          change24hKRW: changeKRW,
          mcapKRW: 0,
          volKRW: Number(v?.acc_trade_value_24H || 0),
          binanceVolKRW: 0,
          kimp: null,
          kimpDiffKRW: null,
          hasBinance: false,
        });
      }

      return out;
    } catch {
      return [];
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

  async function fetchBinancePricesCached(activeSet) {
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
        const data = await fetchJsonWithTimeout(url, 7000);
        const map = new Map();
        const arr = Array.isArray(data) ? data : [];

        for (const item of arr) {
          const sym = String(item?.symbol || "");
          if (!sym.endsWith("USDT")) continue;
          const base = sym.slice(0, -4).toUpperCase();
          if (activeSet && activeSet.size > 0 && !activeSet.has(base)) continue;
          map.set(base, Number(item?.price || 0));
        }

        state._binance.map = map;
        state._binance.ts = now;
        return map;
      } catch {}
    }

    return state._binance.map;
  }

  async function fetchBinanceVolumesCached(activeSet) {
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
        const data = await fetchJsonWithTimeout(url, 7000);
        const map = new Map();
        const arr = Array.isArray(data) ? data : [];

        for (const item of arr) {
          const sym = String(item?.symbol || "");
          if (!sym.endsWith("USDT")) continue;
          const base = sym.slice(0, -4).toUpperCase();
          if (activeSet && activeSet.size > 0 && !activeSet.has(base)) continue;
          map.set(base, Number(item?.quoteVolume || 0));
        }

        state._binance24h.map = map;
        state._binance24h.ts = now;
        return map;
      } catch {}
    }

    return state._binance24h.map;
  }

  function applySignedClass(el, v) {
    if (!el) return;
    const n = Number(v);
    const cls = (!Number.isFinite(n) || Math.abs(n) < 0.005) ? "zero" : (n > 0 ? "plus" : "minus");
    el.classList.add("kimp");
    el.classList.remove("plus", "minus", "zero");
    el.classList.add(cls);
  }

  function applyDerivedFields(list, binanceMap, binanceVolMap) {
    const rate = Number(state.fxKRW || state.usdtKRW || 0);

    for (const c of list) {
      const sym = String(c.symbol || "")
        .toUpperCase()
        .replace(/^KRW-/, "")
        .replace(/^USDT-/, "")
        .replace(/-USDT$/, "");

      const base = toBinanceBase(sym);
      const hasBinance = (base === "USDT") ? true : binanceMap.has(base);
      c.hasBinance = hasBinance;

      const usd = (base === "USDT") ? 1 : (hasBinance ? (Number(binanceMap.get(base)) || 0) : 0);
      c.priceUSD = usd;

      c.binanceKRW = (usd > 0 && rate > 0) ? (usd * rate) : 0;

      const volUSDT = hasBinance ? (Number(binanceVolMap.get(base)) || 0) : 0;
      c.binanceVolKRW = (volUSDT > 0 && rate > 0) ? (volUSDT * rate) : 0;

      let usdCap = 0;
      if (state._coinCaps instanceof Map) {
        usdCap = Number(state._coinCaps.get(sym)) || Number(state._coinCaps.get(base)) || 0;
      }
      c.mcapKRW = (usdCap > 0 && rate > 0) ? (usdCap * rate) : 0;

      if (c.binanceKRW > 0) {
        const krw = Number(c.priceKRW || 0);
        const kimp = ((krw / c.binanceKRW) - 1) * 100;

        if (!Number.isFinite(kimp) || Math.abs(kimp) >= 50) {
          c.kimp = null;
          c.kimpDiffKRW = null;
        } else {
          c.kimp = kimp;
          c.kimpDiffKRW = krw - c.binanceKRW;
        }
      } else {
        c.kimp = null;
        c.kimpDiffKRW = null;
      }
    }
  }

  function renderLiveKimpBoxes(list) {
    const validCoins = (Array.isArray(list) ? list : [])
      .filter(c => typeof c.kimp === "number" && Number.isFinite(c.kimp))
      .filter(c => Math.abs(c.kimp) < 10);

    if (validCoins.length === 0) return;

    const avg = validCoins.reduce((s, c) => s + Number(c.kimp), 0) / validCoins.length;

    let minCoin = validCoins[0];
    let maxCoin = validCoins[0];

    for (const c of validCoins) {
      if (Number(c.kimp) < Number(minCoin.kimp)) minCoin = c;
      if (Number(c.kimp) > Number(maxCoin.kimp)) maxCoin = c;
    }

    const avgEl = document.getElementById("kimpAvg5m");
    const minEl = document.getElementById("kimpMin5m");
    const minCoinEl = document.getElementById("kimpMinCoin5m");
    const maxEl = document.getElementById("kimpMax5m");
    const maxCoinEl = document.getElementById("kimpMaxCoin5m");

    if (avgEl) avgEl.textContent = formatPct(avg);
    if (minEl) minEl.textContent = formatPct(minCoin.kimp);
    if (minCoinEl) minCoinEl.textContent = `(${minCoin.symbol})`;
    if (maxEl) maxEl.textContent = formatPct(maxCoin.kimp);
    if (maxCoinEl) maxCoinEl.textContent = `(${maxCoin.symbol})`;

    applySignedClass(avgEl, avg);
    applySignedClass(minEl, minCoin.kimp);
    applySignedClass(maxEl, maxCoin.kimp);
  }

  async function loadCoinsAndRender(force = false) {
    syncTopMetricsCacheFromDOM();
    saveTopMetricsToLS();

    if (state._isLoading) {
      state._pendingReload = state._pendingReload || force;
      return;
    }
    state._isLoading = true;

    const cachedList = loadTableCache(state.exchange);
    const hasCache = !!(cachedList && cachedList.length > 0);

    const shouldShowSpinner = (state.coins.length === 0) && (force ? !hasCache : true);

    if (shouldShowSpinner) {
      showSpinner();
      coinTableBody.innerHTML = "";
    }

    try {
      const activeSet = await fetchBinanceActiveUsdtBasesCached();
      const [binanceMap, binanceVolMap] = await Promise.all([
        fetchBinancePricesCached(activeSet),
        fetchBinanceVolumesCached(activeSet),
      ]);

      try {
        await fetchAllMarketCaps();
      } catch {}

      let list = [];
      try {
        const coins = await fetchCoinsFromAPI(state.exchange);
        list = Array.isArray(coins) ? coins : [];
      } catch {}

      if (!force && list.length === 0) {
        if (hasCache) list = cachedList;
      }

      if (force && list.length === 0) {
        if (hasCache) list = cachedList;
      }

      applyDerivedFields(list, binanceMap, binanceVolMap);
      renderLiveKimpBoxes(list);

      state.coins = list;
      render();
      if (list.length > 0) saveTableCache(state.exchange, list);
    } catch {
      if (!restoreTableFromCache(state.exchange)) {
        state.coins = [];
        render();
      }
    } finally {
      state._isLoading = false;
      hideSpinner();
      if (state._pendingReload) {
        state._pendingReload = false;
        loadCoinsAndRender(false);
      }
    }
  }

  function startAutoRefresh(ms) {
    stopAutoRefresh();
    state._refreshTimer = setInterval(() => loadCoinsAndRender(false), ms);
  }

  function stopAutoRefresh() {
    if (state._refreshTimer) clearInterval(state._refreshTimer);
    state._refreshTimer = null;
  }

  function pauseTimers() {
    stopAutoRefresh();
  }

  function resumeTimers() {
    if (state._isLoading) return;
    stopAutoRefresh();
    loadCoinsAndRender(false).catch(() => {});
    startAutoRefresh(2000);
  }

  function bindLifecycleEvents() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pauseTimers();
      else resumeTimers();
    });

    window.addEventListener("pageshow", (e) => {
      if (e.persisted) resumeTimers();
    });

    window.addEventListener("pagehide", () => {
      pauseTimers();
    });
  }

  function getPriceDirection(symbol, currentPrice) {
    const key = String(symbol || "").toUpperCase();
    const prev = prevPriceMap.get(key);
    prevPriceMap.set(key, currentPrice);
    if (prev == null) return "";
    if (currentPrice > prev) return "price-flash-up";
    if (currentPrice < prev) return "price-flash-down";
    return "";
  }

  function flashPrice(el, cls) {
    if (!el) return;
    el.classList.remove("price-flash-up", "price-flash-down");
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 700);
  }

  function updateRowsInPlace(rows) {
    if (!rows || rows.length === 0) return;

    for (const c of rows) {
      const sym = String(c.symbol || "").toUpperCase();
      if (state._ioReady && visibleSymbols.size > 0 && !visibleSymbols.has(sym)) continue;

      const tr = coinTableBody.querySelector(`tr[data-symbol="${CSS.escape(sym)}"]`);
      if (!tr) continue;

      const favBtn = tr.querySelector(".favBtn");
      if (favBtn) {
        const isFav = state.favorites.has(sym);
        favBtn.classList.toggle("active", isFav);
        favBtn.innerHTML = getStarSvg(isFav);
      }

      const priceMain = tr.querySelector(".priceMain");
      const priceSub = tr.querySelector(".priceSub");
      if (priceMain) priceMain.textContent = formatKRW(c.priceKRW);
      if (priceSub) priceSub.textContent = formatKRW(c.binanceKRW);

      const priceStack = tr.querySelector(".priceStack");
      const curPrice = Number(c.priceKRW || 0);
      const flashCls = getPriceDirection(sym, curPrice);
      if (priceStack && flashCls) flashPrice(priceStack, flashCls);

      const chgMain = tr.querySelector(".chgMain");
      const chgSub = tr.querySelector(".chgSub");
      if (chgMain) {
        const _chg = Number(c.change24h);
        const chgClass = (Number.isFinite(_chg) && Math.abs(_chg) < 0.005) ? "zero" : (_chg > 0 ? "plus" : "minus");
        chgMain.classList.remove("plus", "minus", "zero");
        chgMain.classList.add(chgClass);
        chgMain.textContent = formatPct(c.change24h);
      }
      if (chgSub) chgSub.textContent = formatDeltaKRW(c.change24hKRW);

      const volMain = tr.querySelector(".volMain");
      const volSub = tr.querySelector(".volSub");
      if (volMain) volMain.textContent = formatKRWCompact(c.volKRW);
      if (volSub) volSub.textContent = formatKRWCompact(c.binanceVolKRW);

      const mcapMain = tr.querySelector(".mcapMain");
      const mcapSub = tr.querySelector(".mcapSub");
      if (mcapMain) mcapMain.textContent = formatMcapKRW(c.mcapKRW);

      if (mcapSub) {
        const usdCap = state._coinCaps instanceof Map ? state._coinCaps.get(sym) : null;
        mcapSub.textContent = formatMcapUSD(usdCap);
      }

      const kimpTd = tr.querySelector(".td-kimp");
      if (kimpTd) {
        const k = c.kimp;
        const cls = (k == null || Number(k) >= 0) ? "plus" : "minus";
        kimpTd.classList.remove("plus", "minus");
        kimpTd.classList.add(cls);
        kimpTd.innerHTML = `${escapeHtml(formatPct(k))}${renderKimpDiff(c.kimpDiffKRW)}`;
      }
    }
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

    if (state.favOnly) list = list.filter(c => state.favorites.has(normalizeBaseSym(c.symbol)));

    list.sort((a, b) => {
      const af = state.favorites.has(normalizeBaseSym(a.symbol));
      const bf = state.favorites.has(normalizeBaseSym(b.symbol));
      if (af !== bf) return af ? -1 : 1;
      return compare(a, b, state.sortKey, state.sortDir);
    });

    return list;
  }

  function syncSortUI() {
    sortableThs.forEach(th => {
      const key = th.dataset.sort;
      th.dataset.dir = (key === state.sortKey && state._sortedOnce) ? state.sortDir : "";
    });
  }

  const INLINE_CHART_HEIGHT = 320;

  function closeInlineChart() {
    if (Array.isArray(state._inlineCharts) && state._inlineCharts.length > 0) {
      for (const it of state._inlineCharts) {
        try { it?.rowEl?.remove(); } catch {}
      }
    }
    state._inlineCharts = [];
  }

  function renderInlineChartFor(containerId, coin) {
    const box = document.getElementById(containerId);
    if (!box) return;

    box.innerHTML = "";

    if (typeof TradingView === "undefined") {
      box.innerHTML = `<div style="padding:12px;color:#94a3b8;">TradingView not loaded</div>`;
      return;
    }

    if (!coin) {
      box.innerHTML = `<div style="padding:12px;color:#94a3b8;">No coin selected</div>`;
      return;
    }

    const tvSymbol = pickTradingViewSymbol(coin);

    new TradingView.widget({
      width: "100%",
      height: INLINE_CHART_HEIGHT,
      symbol: tvSymbol,
      interval: "15",
      timezone: "Asia/Seoul",
      theme: "light",
      style: "1",
      locale: "kr",
      enable_publishing: false,
      allow_symbol_change: true,
      container_id: containerId,
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      save_image: false,
    });
  }

  function toggleInlineChart(anchorTr, coin) {
    const sym = normalizeBaseSym(coin?.symbol);
    if (!sym) return;

    if (!Array.isArray(state._inlineCharts)) state._inlineCharts = [];

    const idx = state._inlineCharts.findIndex(it => it.sym === sym);
    if (idx >= 0) {
      const it = state._inlineCharts[idx];
      try { it?.rowEl?.remove(); } catch {}
      state._inlineCharts.splice(idx, 1);
      return;
    }

    const inlineH = (window.matchMedia("(max-width: 640px)").matches ? 260 : 320);
    const maxN = 2;

    while (state._inlineCharts.length >= maxN) {
      const old = state._inlineCharts.shift();
      try { old?.rowEl?.remove(); } catch {}
    }

    const colspan = anchorTr?.children?.length || 6;

    const chartRow = document.createElement("tr");
    chartRow.className = "inlineChartRow";

    const td = document.createElement("td");
    td.colSpan = colspan;

    const containerId = `tv_inline_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    td.innerHTML = `
      <div class="rowChartWrap">
        <div id="${containerId}" style="width:100%; height:${inlineH}px;"></div>
      </div>
    `;

    chartRow.appendChild(td);
    anchorTr.after(chartRow);

    state._inlineCharts.push({ sym, rowEl: chartRow, containerId, coin });

    renderInlineChartFor(containerId, coin);
  }

  function renderRow(c) {
    const tr = document.createElement("tr");
    tr.dataset.symbol = c.symbol;
    observeRow(tr);

    const isFav = state.favorites.has(normalizeBaseSym(c.symbol));
    const starSvg = getStarSvg(isFav);
    const _chg = Number(c.change24h);
    const chgClass = (Number.isFinite(_chg) && Math.abs(_chg) < 0.005) ? "zero" : (_chg > 0 ? "plus" : "minus");
    const kimpClass = (c.kimp == null || Number(c.kimp) >= 0) ? "plus" : "minus";

    const dirClass = getPriceDirection(c.symbol, Number(c.priceKRW || 0));

    const sym = String(c.symbol || "").toUpperCase();
    const isFailed = imageLoadFailures.has(sym);

    const logoUrl = isFailed ? "images/coins/default.png" : `https://static.upbit.com/logos/${sym}.png`;

    tr.innerHTML = `
      <td class="td-left">
        <div class="assetCell">
          <img class="assetIconImg"
              src="${logoUrl}"
              alt="${escapeHtml(sym)}"
              style="width:24px; height:24px; border-radius:50%; margin-right:8px; vertical-align:middle;"
              ${!isFailed ? `onerror="handleImageError(this, '${sym}')"` : ""}>
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

      <td class="td-right td-kimp change ${kimpClass}">
        ${formatPct(c.kimp)}
        ${renderKimpDiff(c.kimpDiffKRW)}
      </td>

      <td class="td-right volStack col-hide-980">
        <div class="volMain">${formatKRWCompact(c.volKRW)}</div>
        <div class="volSub">${formatKRWCompact(c.binanceVolKRW)}</div>
      </td>

      <td class="td-right mcapStack col-hide-980">
        <div class="mcapMain">${formatMcapKRW(c.mcapKRW)}</div>
        <div class="mcapSub">${formatMcapUSD(state._coinCaps.get(c.symbol))}</div>
      </td>
    `;

    tr.querySelector(".favBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggleFavorite(c.symbol);
    });

    const chartIcon = tr.querySelector(".chartMini");
    if (chartIcon) {
      chartIcon.title = "차트 보기";
      chartIcon.addEventListener("click", (e) => {
        e.stopPropagation();

        if (e.ctrlKey || e.metaKey) {
          const tvSymbol = pickTradingViewSymbol(c);
          const url = `https://kr.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
          window.open(url, "_blank", "noopener");
          return;
        }

        toggleInlineChart(tr, c);
      });
    }

    tr.addEventListener("click", () => {
      toggleInlineChart(tr, c);
    });

    return tr;
  }

  function render() {
    const rows = getFilteredSortedCoins();

    const hasOpenCharts = Array.isArray(state._inlineCharts) && state._inlineCharts.length > 0;
    if (hasOpenCharts) {
      updateRowsInPlace(rows);
      syncSortUI();
      return;
    }

    resetRowObserver();
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

  window.handleImageError = function (img, sym) {
    const symUpper = sym.toUpperCase();

    if (!img.dataset.triedBackup) {
      img.dataset.triedBackup = "true";
      img.src = `https://cryptoicons.org/api/icon/${sym.toLowerCase()}/64`;
      return;
    }

    imageLoadFailures.add(symUpper);
    img.src = "images/coins/default.png";
    img.onerror = null;
  };

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

  function toggleClearBtn() {
    if (!clearSearchBtn) return;
    clearSearchBtn.style.display = state.query.trim() !== "" ? "inline-block" : "none";
  }

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
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...state.favorites]));
    } catch {}
  }

  function toggleFavorite(symbol) {
    const sym = normalizeBaseSym(symbol);
    if (!sym) return;

    if (state.favorites.has(sym)) state.favorites.delete(sym);
    else state.favorites.add(sym);

    saveFavorites();
    render();
  }

  function bindEvents() {
    exchangeSelect?.addEventListener("change", () => {
      closeInlineChart();
      state.exchange = exchangeSelect.value;
      loadCoinsAndRender(true);
    });

    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        closeInlineChart();
        state.query = searchInput.value;
        toggleClearBtn();
        render();
      }
    });

    applyBtn?.addEventListener("click", () => {
      closeInlineChart();
      state.query = searchInput?.value || "";
      toggleClearBtn();
      render();
    });

    clearSearchBtn?.addEventListener("click", () => {
      closeInlineChart();
      state.query = "";
      if (searchInput) searchInput.value = "";
      toggleClearBtn();
      render();
    });

    favoriteOnlyInline?.addEventListener("change", () => {
      closeInlineChart();
      state.favOnly = favoriteOnlyInline.checked;
      render();
    });

    sortableThs.forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        closeInlineChart();
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

  function initMainChart() {
    if (typeof TradingView !== "undefined") {
      new TradingView.widget({
        autosize: true,
        symbol: "BINANCE:BTCUSDT",
        timezone: "Asia/Seoul",
        interval: "15",
        theme: "light",
        style: "1",
        locale: "kr",
        toolbar_bg: "#f1f3f6",
        enable_publishing: false,
        allow_symbol_change: true,
        container_id: "tradingview_main_chart",
        hide_top_toolbar: false,
        hide_side_toolbar: false,
        save_image: false,
      });
    }
  }

  function init() {
    bindEvents();
    toggleClearBtn();

    restoreTopMetricsFromLS();
    startUnifiedTopMetrics();
    bindLifecycleEvents();

    const TITLE_SUFFIX = "실시간 김프 김치프리미엄 - 김프뷰";
    const TITLE_REFRESH_MS = 3000;

    function formatTitlePriceKRW(price) {
      const v = Number(price || 0);
      if (!Number.isFinite(v) || v <= 0) return "";
      return Math.round(v).toLocaleString("ko-KR");
    }

    function formatTitleChangePct(pct) {
      const v = Number(pct);
      if (!Number.isFinite(v)) return "";
      const sign = v > 0 ? "+" : "";
      return `${sign}${v.toFixed(2)}%`;
    }

    function getBtcCoinFromState() {
      return (Array.isArray(state.coins) ? state.coins : []).find(
        (c) => String(c?.symbol || "").toUpperCase() === "BTC"
      ) || null;
    }

    function updateTitleFromState() {
      const btc = getBtcCoinFromState();
      if (!btc) {
        document.title = TITLE_SUFFIX;
        return;
      }

      const changeText = formatTitleChangePct(btc.change24h);
      const priceText = formatTitlePriceKRW(btc.priceKRW);

      if (!priceText) {
        document.title = TITLE_SUFFIX;
        return;
      }

      const prefix = `${changeText || ""} | ${priceText} BTC/KRW`;
      document.title = `${prefix} | ${TITLE_SUFFIX}`;
    }

    if (restoreTableFromCache(state.exchange)) {
      renderLiveKimpBoxes(state.coins);
      render();
    }

    updateTitleFromState();
    setInterval(updateTitleFromState, TITLE_REFRESH_MS);

    loadCoinsAndRender(false).finally(updateTitleFromState);

    startAutoRefresh(2000);

    let tvInited = false;
    const initMainChartDeferred = () => {
      if (tvInited) return;
      tvInited = true;
      initMainChart();
    };

    window.addEventListener("pointerdown", initMainChartDeferred, { once: true });
    window.addEventListener("scroll", initMainChartDeferred, { once: true, passive: true });
    setTimeout(initMainChartDeferred, 1500);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
