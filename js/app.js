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

function showSpinner() {
  if (tableSpinner) tableSpinner.style.display = "flex";
  if (tableWrapEl) tableWrapEl.style.display = "none";  
}

function hideSpinner() {
  if (tableSpinner) tableSpinner.style.display = "none";
  if (tableWrapEl) tableWrapEl.style.display = "";     
}

if (!coinTableBody) {
  console.warn("[KIMPVIEW] #coinTableBody 없음. HTML id 확인!");
  return;
}

const LS_KEY = "kimpview:favorites";
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
  _coinCaps: new Map(),
  _coinCapsTs: 0,
  _refreshTimer: null,
  _aborter: null,
  _isLoading: false,
  fxKRW: 0,
  usdtKRW: 0,
  btcDom: 0,
  _inlineCharts: [],
  _inlineMaxCharts: 3,
  _binance: { map: new Map(), ts: 0, ttlMs: 3000 },
  _binance24h: { map: new Map(), ts: 0, ttlMs: 3000 },
  _binanceActive: { set: new Set(), ts: 0, ttlMs: 60_000 },
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

function makeTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      console.warn(`[${label}] fetch failed (attempt ${attempt + 1}/${retries + 1}):`, url, e?.message || e);
      await sleep(200 * (attempt + 1));
      continue;
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    if (!res.ok) {
      console.warn(`[${label}] HTTP ${res.status} (attempt ${attempt + 1}/${retries + 1}):`, url, text.slice(0, 200));

      if ((res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < retries) {
        await sleep(250 * (attempt + 1));
        continue;
      }

      throw new Error(`HTTP ${res.status}`);
    }

    if (!ct.includes("application/json")) {
      console.warn(`[${label}] Not JSON:`, url, ct, text.slice(0, 200));
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw new Error("Not JSON");
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      console.warn(`[${label}] JSON parse failed:`, url, text.slice(0, 200));
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error("fetch failed");
}

const LS_TABLE_PREFIX = "kimpview:tableCache:v1:";
const LS_TOPMETRICS = "kimpview:topmetricsCache:v1";

function tableCacheKey(exchange) {
  return LS_TABLE_PREFIX + String(exchange || "upbit_krw").toLowerCase();
}

const TABLE_TTL_MS = 10 * 1000;

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
  render();
  return true;
}

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
  } catch (e) {
    console.warn("[KIMPVIEW] fetchBinanceActiveUsdtBasesCached failed:", e?.message || e);
    return state._binanceActive.set;
  }
}

const SYMBOL_ALIAS = new Map([
  ["BTT", "BTTC"],
]);

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

    if (KIMP_EXCLUDE.has(sym) && sym !== "USDT") {
      c.kimp = null;
      c.kimpDiffKRW = null;
    }
  }
}

async function loadCoinsAndRender(force = false) {
  syncTopMetricsCacheFromDOM();
  saveTopMetricsToLS();

  if (!force && state._isLoading) return;
  state._isLoading = true;

const shouldShowSpinner = force || (state.coins.length === 0);

if (shouldShowSpinner) {
  showSpinner();
  coinTableBody.innerHTML = "";
}

  try {
    if (!force) restoreTableFromCache(state.exchange);

    const activeSet = await fetchBinanceActiveUsdtBasesCached();

    const [binanceMap, binanceVolMap] = await Promise.all([
      fetchBinancePricesCached(activeSet),
      fetchBinanceVolumesCached(activeSet),
    ]);

    await fetchAllMarketCaps();

    let list = [];
    try {
      const coins = await fetchCoinsFromAPI(state.exchange);
      list = Array.isArray(coins) ? coins : [];
    } catch (e) {
      console.error("거래소 데이터 로드 실패", e);
    }

    if (!force && list.length === 0) {
      const cached = loadTableCache(state.exchange);
      if (cached && cached.length > 0) list = cached;
    }

    applyDerivedFields(list, binanceMap, binanceVolMap);

    state.coins = list;
    render();
    if (list.length > 0) saveTableCache(state.exchange, list);

  } catch (err) {
    console.warn("[KIMPVIEW] loadCoinsAndRender failed:", err);
    if (!restoreTableFromCache(state.exchange)) {
      state.coins = [];
      render();
    }
  } finally {
    state._isLoading = false;
    hideSpinner();
  }
}

bindEvents();
bindAlertCollapse();
toggleClearBtn();

restoreTopMetricsFromLS();
startUnifiedTopMetrics();

loadCoinsAndRender(true);
startAutoRefresh(2000);

const $longRate = document.getElementById("longRate");
const $shortRate = document.getElementById("shortRate");
const $fearGreed = document.getElementById("fearGreed");

const $tradeAlertBody = document.getElementById("tradeAlertBody");
const $liquidAlertBody = document.getElementById("liquidAlertBody");

let sideState = {
  tradeRows: [],
  liqRows: [],
};

function makeEmptyRow() {
  return { sym: "", type: "", label: null, amount: null, price: null, time: null };
}

function renderAlert(kind) {
  const tbody = (kind === "trade") ? $tradeAlertBody : $liquidAlertBody;
  if (!tbody) return;

  const rows = (kind === "trade") ? sideState.tradeRows : sideState.liqRows;

  tbody.innerHTML = rows.map(r => {
    const isEmpty = !r.sym;
    const emptyClass = isEmpty ? "is-empty" : "";

    const labelText = (r.label == null || r.label === "") ? "&nbsp;" : escapeHtml(String(r.label));
    const timeText = (r.time == null || r.time === "") ? "&nbsp;" : escapeHtml(String(r.time));
    const amountText = (r.amount == null) ? "&nbsp;" : escapeHtml(formatKoreanMoneyKRW(r.amount) || "");
    const priceText = (r.price != null && Number.isFinite(r.price))
      ? escapeHtml("$" + Number(r.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : "&nbsp;";

    let trClass = "";
    if (kind === "trade") {
      trClass = (r.type === "롱") ? "buy" : (r.type === "숏") ? "sell" : "";
    } else {
      const isLong = String(r.type || r.label || "").includes("롱");
      const isShort = String(r.type || r.label || "").includes("숏");
      trClass = `liq ${isLong ? "long" : isShort ? "short" : ""}`.trim();
    }

    const labelCell = (r.label == null || r.label === "")
      ? "&nbsp;"
      : `<span class="labelWithEx">
          <img class="exIcon"
                src="images/binance.png"
                alt="Binance"
                width="14"
                height="14"
                onerror="this.onerror=null; this.style.display='none';">
          ${labelText}
        </span>`;

    return `
      <tr class="${trClass} ${emptyClass}">
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
  sideState.tradeRows = sideState.tradeRows.slice(0, 3);
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
  sideState.liqRows = sideState.liqRows.slice(0, 3);
  renderLiq();
}

sideState.tradeRows = Array.from({ length: 3 }, makeEmptyRow);
sideState.liqRows = Array.from({ length: 3 }, makeEmptyRow);
renderTrade();
renderLiq();

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

async function fetchCoinsFromAPI(exchange) {
  exchange = (exchange || "upbit_krw").toLowerCase();

  if (state._aborter) state._aborter.abort();
  state._aborter = new AbortController();
  const signal = state._aborter.signal;

  if (exchange === "upbit_krw") return await fromUpbit(signal);
  if (exchange === "bithumb_krw") return await fromBithumb(signal);

  return await fromUpbit(signal);
}

const CAPS_LS_KEY = "kimpview:capsCache:v1";
const CAPS_TTL_MS = 30 * 60 * 1000;

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

async function fetchAllMarketCaps() {
  const now = Date.now();

  if (state._coinCaps instanceof Map && state._coinCaps.size > 0 && state._coinCapsTs > 0) {
    if ((now - state._coinCapsTs) < CAPS_TTL_MS) {
      return state._coinCaps;
    }
  }

  const ls = loadCapsFromLS();
  if (ls && typeof ls === "object" && !Array.isArray(ls)) {
    state._coinCaps = new Map(Object.entries(ls));
    state._coinCapsTs = now;
    return state._coinCaps;
  }

  const WORKER_URL = "https://kimpview-proxy.cjstn3391.workers.dev/coinpaprika-caps";
  state.__capsUrlUsed = WORKER_URL;

  const data = await safeFetchJson(WORKER_URL, { label: "Caps" });

  if (data?.ok === true && Array.isArray(data?.routes)) {
    console.error("CAPS WRONG PAYLOAD:", data);
    throw new Error("Caps endpoint wrong: hit / instead of /coinpaprika-caps");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Caps payload invalid");
  }

  state._coinCaps = new Map(Object.entries(data));
  state._coinCapsTs = now;
  saveCapsToLS(data);
  return state._coinCaps;
}

async function getUpbitMarkets(signal) {
  if (upbitMarketsCache && (Date.now() - upbitMarketsCache.ts) < UPBIT_MARKETS_TTL_MS) {
    return upbitMarketsCache.marketsJson;
  }

  let lsBackup = null;
  try {
    const raw = localStorage.getItem(UPBIT_MARKETS_LS);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.data) lsBackup = obj.data;
      if (obj && obj.ts && (Date.now() - Number(obj.ts)) <= UPBIT_MARKETS_TTL_MS) {
        upbitMarketsCache = { ts: Number(obj.ts), marketsJson: obj.data };
        return obj.data;
      }
    }
  } catch {}

  try {
    const marketsJson = await safeFetchJson(`${UPBIT_PROXY}/v1/market/all?isDetails=false`, {
      signal,
      timeoutMs: 12000,
      label: "UPBIT markets",
      retries: 2,
    });

    upbitMarketsCache = { ts: Date.now(), marketsJson };
    saveUpbitMarketsToLS(marketsJson);
    return marketsJson;
  } catch (e) {
    if (lsBackup) {
      console.warn("[UPBIT markets] network failed, using localStorage backup");
      upbitMarketsCache = { ts: Date.now(), marketsJson: lsBackup };
      return lsBackup;
    }
    throw e;
  }
}

async function fromUpbit(signal) {
  try {
    const marketsJson = await getUpbitMarkets(signal);

    const markets = Array.isArray(marketsJson) ? marketsJson : [];
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
  } catch (e) {
    console.warn("[KIMPVIEW] fromUpbit failed:", e?.message || e);
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
  } catch (e) {
    console.warn("[KIMPVIEW] fromBithumb failed:", e?.message || e);
    return [];
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      const data = await res.json();

      const map = new Map();
      for (const item of data) {
        const sym = String(item?.symbol || "");
        if (!sym.endsWith("USDT")) continue;

        const base = sym.slice(0, -4).toUpperCase();

        if (activeSet && activeSet.size > 0 && !activeSet.has(base)) continue;

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
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      const data = await res.json();

      const map = new Map();
      for (const item of data) {
        const sym = String(item?.symbol || "");
        if (!sym.endsWith("USDT")) continue;

        const base = sym.slice(0, -4).toUpperCase();

        if (activeSet && activeSet.size > 0 && !activeSet.has(base)) continue;

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

function startAutoRefresh(ms) {
  stopAutoRefresh();
  state._refreshTimer = setInterval(() => loadCoinsAndRender(false), ms);
}

function stopAutoRefresh() {
  if (state._refreshTimer) clearInterval(state._refreshTimer);
  state._refreshTimer = null;
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

function renderRow(c) {
  const tr = document.createElement("tr");
  tr.dataset.symbol = c.symbol;
  observeRow(tr);

  const isFav = state.favorites.has(c.symbol);
  const starSvg = getStarSvg(isFav);
  const _chg = Number(c.change24h);
  const chgClass = (Number.isFinite(_chg) && Math.abs(_chg) < 0.005) ? "zero" : (_chg > 0 ? "plus" : "minus");
  const kimpClass = (c.kimp == null || Number(c.kimp) >= 0) ? "plus" : "minus";

  const dirClass = getPriceDirection(c.symbol, Number(c.priceKRW || 0));

  const sym = String(c.symbol || "").toUpperCase();
  const isFailed = imageLoadFailures.has(sym);

  const logoUrl = isFailed
    ? "images/coins/default.png"
    : `https://static.upbit.com/logos/${sym}.png`;

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

function bindEvents() {
  exchangeSelect?.addEventListener("change", () => {
    closeInlineChart();
    state.exchange = exchangeSelect.value;
    loadCoinsAndRender(false);
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
  const sym = normalizeBaseSym(symbol);
  if (!sym) return;

  if (state.favorites.has(sym)) state.favorites.delete(sym);
  else state.favorites.add(sym);

  saveFavorites();
  render();
}

function renderKimpDiff(diff) {
  if (diff == null || Number.isNaN(Number(diff))) return "";
  const v = Number(diff);

  if (!Number.isFinite(v) || v === 0) return "";

  return `<span class="kimpSub smallkimpsub">${formatKRWDiff(v)}</span>`;
}

function formatKRWDiff(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "";

  const sign = v > 0 ? "+" : "-";
  const abs = Math.abs(v);

  let s;
  if (abs < 1) {
    s = abs.toFixed(6);
  } else if (abs < 100) {
    s = abs.toFixed(2);
  } else {
    s = Math.floor(abs).toLocaleString("ko-KR");
  }

  s = s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");

  if (s.includes(".") && abs >= 1) {
    const [i, d] = s.split(".");
    s = Number(i).toLocaleString("ko-KR") + "." + d;
  }

  return sign + s;
}

function formatKRW(n) {
  const v = Number(n || 0);
  if (!v) return "";

  let digits = 0;

  if (v >= 100) {
    digits = 0;
  } else if (v < 0.001) {
    digits = 10;
  } else if (v < 1) {
    digits = 6;
  } else {
    digits = 2;
  }

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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
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

function toggleClearBtn() {
  if (!clearSearchBtn) return;
  clearSearchBtn.style.display = state.query.trim() !== "" ? "inline-block" : "none";
}

function parseNumberFromText(text) {
  const s = String(text ?? "").replace(/[^\d.]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function syncTopMetricsCacheFromDOM() {
  const fxEl = document.getElementById("fxKRW");
  const usdtEl = document.getElementById("usdtKRW");

  const fx = fxEl ? parseNumberFromText(fxEl.textContent) : 0;
  const usdt = usdtEl ? parseNumberFromText(usdtEl.textContent) : 0;

  if (fx > 1000 && fx < 3000) state.fxKRW = fx;
  if (usdt > 500 && usdt < 5000) state.usdtKRW = usdt;

  if (state.usdtKRW > 0) window.__USDT_KRW = state.usdtKRW;
}

function startUnifiedTopMetrics() {
  const loader = window.KIMPVIEW?.loadTopMetrics;

  const runOnce = () => {
    if (typeof loader === "function") {
      Promise.resolve(loader())
        .catch(() => { })
        .finally(() => syncTopMetricsCacheFromDOM());
    } else {
      syncTopMetricsCacheFromDOM();
    }
  };

  runOnce();
  setInterval(runOnce, 60_000);
}

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

const ALERT_SYMBOLS = ["BTC", "ETH", "XRP", "SOL", "DOGE", "BNB", "SUI", "ADA", "BCH", "TRX", "LTC"];

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
    try { wsFutures.close(); } catch { }
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
    sideState.tradeRows = Array.from({ length: 3 }, makeEmptyRow);
    sideState.liqRows = Array.from({ length: 3 }, makeEmptyRow);
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
      const amountKRW = toKrwByUsdt(priceUSDT * qty);

      if (!amountKRW) return;
      if (amountKRW < TRADE_MIN_KRW) return;
      if (!passCooldown(lastHitTrade, sym)) return;

      pushTradeRow({ sym, type, amountKRW, priceUSD: priceUSDT });
    }

    if (data.e === "forceOrder") {
      const o = data.o || {};
      const sym = String(o.s || "").replace("USDT", "");
      const side = String(o.S || "");

      const qty = Number(o.z || o.l || o.q || 0);
      const priceUSDT = Number(o.ap || o.p || 0);
      if (!priceUSDT || !qty) return;

      const liqType = (side === "SELL") ? "롱 청산" : "숏 청산";
      const amountKRW = toKrwByUsdt(priceUSDT * qty);

      if (!amountKRW) return;
      if (amountKRW < LIQ_MIN_KRW) return;
      if (!passCooldown(lastHitLiq, sym)) return;

      pushLiqRow({ sym, liqType, amountKRW, priceUSD: priceUSDT });
    }
  };

  wsFutures.onerror = () => console.warn("[KIMPVIEW] Futures WS error");

  wsFutures.onclose = () => {
    const wait = Math.min(10_000, 800 * Math.pow(1.6, wsRetry++));
    console.warn(`[KIMPVIEW] Futures WS closed. retry in ${Math.round(wait)}ms`);
    setTimeout(connectFuturesWS, wait);
  };
}

connectFuturesWS();

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

window.addEventListener("DOMContentLoaded", initMainChart);
})();