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

    // ✅ 환율(1 USD = ? KRW), USDT(KRW) 캐시
    fxKRW: 0,
    usdtKRW: 0,

    // ✅ 바이낸스 티커 캐시(1초 갱신 시 과호출 방지)
    _binance: {
      map: new Map(),
      ts: 0,
      ttlMs: 3000, // 3초마다 1번만 갱신 (원하면 1000으로 줄여도 됨)
    },
  };

  // ✅ 이전 현재가 저장(상승/하락 색상용)
  const prevPriceMap = new Map(); // symbol -> previous priceKRW

  // ===== INIT =====
  bindEvents();
  toggleClearBtn();

  loadTopMetrics();        // 환율 먼저 받아두고
  loadCoinsAndRender(true);

  // ✅ 1초 자동갱신
  startAutoRefresh(1000);

  // ===== API 로드 =====
  async function loadCoinsAndRender(initial = false) {
    if (state._isLoading) return; // 로딩 중이면 스킵
    state._isLoading = true;

    try {
      // 1) 업비트(또는 선택 거래소) 코인 목록
      const coins = await fetchCoinsFromAPI(state.exchange);
      const list = Array.isArray(coins) ? coins : [];

      // 2) 바이낸스(USDT) 가격 맵
      const binanceMap = await fetchBinancePricesCached();

      // 3) 매칭 + 바이낸스 원화 변환 + 김프 계산
      const usdt = Number(state.usdtKRW || 0);

      for (const c of list) {
        // 바이낸스 USD(=USDT) 가격
        let usd = 0;

        // ✅ USDT는 "1달러"로 처리 (USDTUSDT 페어 없음)
        if (c.symbol === "USDT") usd = 1;
        else usd = binanceMap.get(c.symbol) || 0;

        c.priceUSD = usd;

        // ✅ 바이낸스 원화(= USD × 환율)
        c.binanceKRW = (usd > 0 && state.fxKRW > 0) ? (usd * state.fxKRW) : 0;

        // ✅ 국내가 - 바이낸스환산가(원)
        c.kimpDiffKRW = (c.binanceKRW > 0) ? (Number(c.priceKRW || 0) - c.binanceKRW) : null;

        // ✅ 김프(%) = 업비트KRW / 바이낸스KRW - 1
        c.kimp = (c.binanceKRW > 0)
          ? ((Number(c.priceKRW || 0) / c.binanceKRW) - 1) * 100
          : null;
      }

      state.coins = list;

      if (initial) {
        // 최초부터 active 화살표 보이게 하고 싶으면 아래 한 줄 켜기:
        // state._sortedOnce = true;
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

  // ===== 거래소 API 직접 호출(서버/Netlify 없이) =====
  async function fetchCoinsFromAPI(exchange) {
    exchange = (exchange || "upbit_krw").toLowerCase();

    // 이전 요청 취소
    if (state._aborter) state._aborter.abort();
    state._aborter = new AbortController();
    const signal = state._aborter.signal;

    // ✅ 지금은 업비트만 진행 권장
    if (exchange === "upbit_krw") return await fromUpbit(signal);

    // 혹시 옵션 남겨둔 경우를 위한 fallback(안 쓰면 무시)
    if (exchange === "bithumb_krw") return await fromBithumb(signal);
    if (exchange === "coinone_krw") return await fromCoinone(signal);

    return await fromUpbit(signal);
  }

  // -------- UPBIT (KRW markets) --------
  async function fromUpbit(signal) {
    const markets = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", { signal })
      .then(r => r.json());

    const krw = markets.filter(m => String(m.market || "").startsWith("KRW-"));

    // ✅ 1초 갱신이면 너무 많으면 느릴 수 있음 (100~150 추천)
    const MAX = 120;

    // ✅ 대표 코인은 무조건 포함(순서 문제로 BTC 빠지는 현상 방지)
    const MUST = [
      "KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE",
      "KRW-ADA", "KRW-BCH", "KRW-LTC", "KRW-TRX", "KRW-USDT"
    ];

    const marketSet = new Set(krw.map(m => m.market));
    const sorted = [...krw].sort((a, b) => String(a.market).localeCompare(String(b.market)));

    const list = [];

    for (const m of MUST) {
      if (marketSet.has(m)) list.push(m);
    }
    for (const m of sorted) {
      if (list.length >= MAX) break;
      if (list.includes(m.market)) continue;
      list.push(m.market);
    }

    const chunks = chunk(list, 80);
    const tickers = [];
    for (const c of chunks) {
      const t = await fetch(
        `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(c.join(","))}`,
        { signal }
      ).then(r => r.json());
      tickers.push(...t);
    }

    const nameMap = new Map(krw.map(m => [m.market, m.korean_name]));

    return tickers.map(t => {
      const symbol = String(t.market).replace("KRW-", "");
      const priceKRW = Number(t.trade_price || 0);
      const change24h = Number(t.signed_change_rate || 0) * 100;
      const volKRW = Number(t.acc_trade_price_24h || 0);

      return {
        symbol,
        name: nameMap.get(t.market) || symbol,
        priceKRW,
        priceUSD: 0,      // ✅ 바이낸스로 채움
        binanceKRW: 0,    // ✅ 바이낸스원화(환율곱)
        change24h,
        mcapKRW: 0,       // 시총은 거래소가 안 줌(나중에 CoinGecko/서버)
        volKRW,
        kimp: null,       // ✅ 계산되면 숫자, 아니면 null
        kimpDiffKRW: null, // ✅ 국내가 - 바이낸스환산가(원)
      };
    });
  }

  // -------- BITHUMB (ALL_KRW) --------
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
        mcapKRW: 0,
        volKRW: Number(v?.acc_trade_value_24H || 0),
        kimp: null,
      });
    }
    return out;
  }

  // -------- COINONE (ticker_new/KRW) --------
  async function fromCoinone(signal) {
    const data = await fetch("https://api.coinone.co.kr/public/v2/ticker_new/KRW", { signal })
      .then(r => r.json());

    const tickers = Array.isArray(data?.tickers) ? data.tickers : [];

    return tickers
      .filter(t => t && t.target_currency)
      .map(t => ({
        symbol: String(t.target_currency || "").toUpperCase(),
        name: String(t.target_currency || "").toUpperCase(),
        priceKRW: Number(t.last || 0),
        priceUSD: 0,
        binanceKRW: 0,
        change24h: 0,
        mcapKRW: 0,
        volKRW: Number(t.quote_volume || 0),
        kimp: null,
        kimpDiffKRW: null,
      }));
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
      "https://data-api.binance.vision/api/v3/ticker/price", // ✅ 우선
      "https://api.binance.com/api/v3/ticker/price",         // ✅ 백업
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

          const base = sym.slice(0, -4); // BTCUSDT -> BTC
          map.set(base, Number(item.price || 0));
        }

        state._binance.map = map;
        state._binance.ts = now;
        return map;
      } catch (e) {
        console.warn("[KIMPVIEW] Binance endpoint 실패:", e);
      }
    }

    return state._binance.map; // 전부 실패하면 캐시(없으면 빈 맵)
  }

  // ===== AUTO REFRESH =====
  function startAutoRefresh(ms) {
    stopAutoRefresh();
    state._refreshTimer = setInterval(() => {
      loadCoinsAndRender(false);
    }, ms);
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
    rows.forEach((c) => frag.appendChild(renderRow(c)));
    coinTableBody.appendChild(frag);

    syncSortUI();
  }

  function getPriceDirection(symbol, currentPrice){
    const prev = prevPriceMap.get(symbol);
    // 업데이트는 항상 해둠(다음 비교용)
    prevPriceMap.set(symbol, currentPrice);
    if (prev == null) return "";          // 최초 1회는 색 없음
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

      <!-- 현재가(업비트 위) + 바이낸스 환산(아래) -->
      <td class="td-right priceStack ${dirClass}">
        <div class="priceMain">${formatKRW(c.priceKRW)}</div>
        <span class="priceSub">${formatKRW(c.binanceKRW)}</span>
      </td>

      <td class="td-right change ${chgClass}">${formatPct(c.change24h)}</td>
      <td class="td-right priceStrong">${formatKRWCompact(c.volKRW)}</td>
      <td class="td-right priceStrong">${formatKRWCompact(c.mcapKRW)}</td>

      <!-- 김프 -->
      <td class="td-right change ${kimpClass}">
        ${formatPct(c.kimp)}
        ${renderKimpDiff(c.kimpDiffKRW)}
      </td>
    `;

    // ✅ 색상은 잠깐만 강조(원하면 주석 처리 가능)
    const el = tr.querySelector(".priceStack");
    if (el && dirClass) {
      setTimeout(() => el.classList.remove("price-flash-up","price-flash-down"), 800);
    }

    tr.querySelector(".favBtn")?.addEventListener("click", () => {
      toggleFavorite(c.symbol);
    });

    // ✅ 차트 아이콘: 툴팁 + 클릭 → CoinMarketCap 새창
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
        (c) =>
          String(c.symbol || "").toLowerCase().includes(q) ||
          String(c.name || "").toLowerCase().includes(q)
      );
    }

    if (state.favOnly) {
      list = list.filter((c) => state.favorites.has(c.symbol));
    }

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
    sortableThs.forEach((th) => {
      const key = th.dataset.sort;
      if (key === state.sortKey && state._sortedOnce) {
        th.dataset.dir = state.sortDir;
      } else {
        th.dataset.dir = "";
      }
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

    sortableThs.forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (!key) return;

        state._sortedOnce = true;

        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
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
    const v = Number(n || 0);
    const sign = v > 0 ? "+" : v < 0 ? "-" : "";
    const abs = Math.abs(v);
    return sign + Math.floor(abs).toLocaleString("ko-KR");
  }

  function formatKRW(n) {
  const v = Number(n || 0);
  if (!v) return "-";

  // ✅ 100원 미만 코인은 소수점 표시
  // - 0~1원: 소수 4자리
  // - 1~10원: 소수 3자리
  // - 10~100원: 소수 2자리
  if (v < 100) {
    let digits = 2;
    if (v < 1) digits = 4;
    else if (v < 10) digits = 3;

    return "₩" + v.toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  // ✅ 100원 이상은 정수로
  return "₩" + Math.floor(v).toLocaleString("ko-KR");
}

  function formatPct(n) {
    if (n == null || Number.isNaN(Number(n))) return "-";
    const v = Number(n);
    const sign = v > 0 ? "+" : "";
    return sign + v.toFixed(2) + "%";
  }

  function formatKRWCompact(n) {
  const v = Number(n || 0);
  if (!v) return "-";

  const ONE_EOK = 100_000_000;
  const TEN_M = 10_000_000;
  const ONE_JO = 1_000_000_000_000;

  // ✅ 1조 이상
  if (v >= ONE_JO) {
    const jo = Math.floor(v / ONE_JO);
    const eok = Math.floor((v % ONE_JO) / ONE_EOK);
    return eok > 0
      ? `${jo.toLocaleString("ko-KR")}조 ${eok.toLocaleString("ko-KR")}억`
      : `${jo.toLocaleString("ko-KR")}조`;
  }

  // ✅ 1억 이상
  if (v >= ONE_EOK) {
    const eok = Math.floor(v / ONE_EOK);
    return `${eok.toLocaleString("ko-KR")}억`;
  }

  // ✅ 1억 미만 → 천만 단위
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

  
  

// ===== ICONS (SVG) =====
function getStarSvg(filled){
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
  // ✅ 대표 코인은 slug로 '상세페이지' 바로 이동, 없으면 검색으로 fallback
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
    try {
      // 1) CoinGecko (시장 전체 지표)
      const geo = await fetch("https://api.coingecko.com/api/v3/global").then(r => r.json());

      // 2) 환율 (USD -> KRW)
// ✅ 여러 소스 시도 + 마지막 정상값 캐시 유지 (구글 화면값과 1:1 맞추려는 목적 X, '자동+안정' 목적)
let krwRate = Number(state.fxKRW || 0);

const fxSources = [
  {
    tag: "ER",
    url: "https://open.er-api.com/v6/latest/USD",
    pick: (j) => Number(j?.rates?.KRW ?? 0),
  },
  // 필요하면 아래 소스를 켜도 됨(환경에 따라 CORS/응답 형식이 다를 수 있어 실패해도 자동으로 다음 소스로 넘어감)
  {
    tag: "FF",
    url: "https://api.frankfurter.app/latest?from=USD&to=KRW",
    pick: (j) => Number(j?.rates?.KRW ?? 0),
  },
];

let fxTag = "-";
for (const s of fxSources) {
  try {
    const j = await fetch(s.url, { cache: "no-store" }).then((r) => r.json());
    const next = s.pick(j);

    // ✅ 이상치 필터 (대충 1,000~3,000원 사이만 허용)
    if (next > 1000 && next < 3000) {
      krwRate = next;
      fxTag = s.tag;
      state.fxKRW = next;
      break;
    }
  } catch (e) {
    // 실패하면 다음 소스 시도
  }
}

// 3) USDT (Upbit) - 표시는 하되, 김프 환산 기준은 USDKRW(krwRate)를 사용
const usdt = await fetch("https://api.upbit.com/v1/ticker?markets=KRW-USDT", { cache: "no-store" }).then(r => r.json());
const usdtKRW = Number(usdt?.[0]?.trade_price ?? 0);

      // ✅ state에 저장 (바이낸스KRW 변환에 사용)
      state.fxKRW = krwRate;
      state.usdtKRW = usdtKRW;
      // ✅ 전역으로도 저장(다른 스크립트/기능에서 사용 가능)
      window.__USDT_KRW = usdtKRW;

      // DOM 업데이트
      const $fx = document.getElementById("fxKRW");
      const $usdt = document.getElementById("usdtKRW");
      const $dom = document.getElementById("btcDominance");
      const $mcap = document.getElementById("totalMcap");
      const $vol = document.getElementById("totalVolume");
      const $cb = document.getElementById("cbPremium");

      if ($fx) $fx.textContent = krwRate ? `${krwRate.toLocaleString("ko-KR")}원 (${fxTag})` : "-";
      if ($usdt) $usdt.textContent = usdtKRW ? (usdtKRW.toLocaleString("ko-KR") + "원") : "-";

      const dom = geo?.data?.market_cap_percentage?.btc ?? null;
      if ($dom) $dom.textContent = (dom == null) ? "-" : (Number(dom).toFixed(2) + "%");

      const mcapKrw = geo?.data?.total_market_cap?.krw ?? 0;
      const volKrw = geo?.data?.total_volume?.krw ?? 0;
      if ($mcap) $mcap.textContent = mcapKrw ? formatKRWCompact(mcapKrw) : "-";
      if ($vol) $vol.textContent = volKrw ? formatKRWCompact(volKrw) : "-";

      // ✅ 테더 프리미엄(USDT 김프) = (업비트 USDT / USDKRW - 1) * 100
      const usdtPremPct = (usdtKRW && krwRate) ? ((usdtKRW / krwRate) - 1) * 100 : null;
      if ($cb) $cb.textContent = (usdtPremPct == null) ? "-" : ((usdtPremPct >= 0 ? "+" : "") + usdtPremPct.toFixed(2) + "%");

      // ✅ 환율이 바뀌면 김프/바이낸스원화도 같이 갱신되게 한 번 더 렌더
      // (coins는 이미 있을 수 있어서)
      if (state.coins.length > 0) {
        // 지금 coins에 있는 priceUSD 기준으로 binanceKRW/kimp 재계산
        const fx2 = Number(state.fxKRW || 0);
        for (const c of state.coins) {
          const usd = Number(c.priceUSD || 0);
          c.binanceKRW = (usd > 0 && fx2 > 0) ? (usd * fx2) : 0;
          c.kimpDiffKRW = (c.binanceKRW > 0) ? (Number(c.priceKRW || 0) - c.binanceKRW) : null;
          c.kimp = (c.binanceKRW > 0)
            ? ((Number(c.priceKRW || 0) / c.binanceKRW) - 1) * 100
            : null;
        }
        render();
      }
    } catch (e) {
      console.warn("[KIMPVIEW] TopMetrics API 실패", e);
    }
  }

  // ===== SIDE (더미 시장현황/알림) =====
  const $longRate = document.getElementById("longRate");
  const $shortRate = document.getElementById("shortRate");
  const $fearGreed = document.getElementById("fearGreed");
  const $tradeAlertBody = document.getElementById("tradeAlertBody");
  const $liquidAlertBody = document.getElementById("liquidAlertBody");

  const coins = ["BTC", "ETH", "XRP", "SOL", "DOGE"];
  const tradeTypes = ["매수", "매도"];
  const liqTypes = ["롱 청산", "숏 청산"];

  function pad2(n){ return String(n).padStart(2,"0"); }
  function nowTime(){
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function rand(min, max){ return Math.random() * (max - min) + min; }
  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function formatKoreanMoneyKRW(amount){
    if (amount >= 1e8) return (amount/1e8).toFixed(2) + "억";
    if (amount >= 1e4) return (amount/1e4).toFixed(0) + "만";
    return Math.round(amount).toLocaleString("ko-KR");
  }

  let sideState = {
    long: 68.8,
    fear: 23,
    tradeRows: [],
    liqRows: [],
  };

  function seedRows(){
    sideState.tradeRows = [ makeTradeRow(), makeTradeRow() ];
    sideState.liqRows = [ makeLiqRow(), makeLiqRow() ];
  }

  function makeTradeRow(){
    const sym = coins[Math.floor(Math.random()*coins.length)];
    const type = tradeTypes[Math.floor(Math.random()*tradeTypes.length)];
    const price = Math.round(rand(1_000, 150_000_000));
    const amount = rand(5_000_000, 300_000_000);
    return { sym, type, label:`${sym} ${type}`, amount, price, time: nowTime() };
  }

  function makeLiqRow(){
    const sym = coins[Math.floor(Math.random()*coins.length)];
    const type = liqTypes[Math.floor(Math.random()*liqTypes.length)];
    const price = Math.round(rand(1_000, 150_000_000));
    const amount = rand(3_000_000, 200_000_000);
    return { sym, type, label:`${sym} ${type}`, amount, price, time: nowTime() };
  }

  function renderTrade(){
    if (!$tradeAlertBody) return;

    $tradeAlertBody.innerHTML = sideState.tradeRows.map(r => {
      const cls = (r.type === "매수") ? "buy" : "sell";
      return `
        <tr class="${cls}">
          <td>${r.label}</td>
          <td>${formatKoreanMoneyKRW(r.amount)}</td>
          <td>${r.price.toLocaleString("ko-KR")}</td>
          <td>${r.time}</td>
        </tr>
      `;
    }).join("");
  }

  function renderLiq(){
    if (!$liquidAlertBody) return;

    $liquidAlertBody.innerHTML = sideState.liqRows.map(r => {
      const isLong = String(r.label).includes("롱");
      const cls = isLong ? "long" : "short";
      return `
        <tr class="liq ${cls}">
          <td>${r.label}</td>
          <td>${formatKoreanMoneyKRW(r.amount)}</td>
          <td>${r.price.toLocaleString("ko-KR")}</td>
          <td>${r.time}</td>
        </tr>
      `;
    }).join("");
  }

  function renderMarket(){
    if (!$longRate || !$shortRate || !$fearGreed) return;

    $longRate.textContent = sideState.long.toFixed(1) + "%";
    $shortRate.textContent = (100 - sideState.long).toFixed(1) + "%";
    $fearGreed.textContent = Math.round(sideState.fear);
  }

  function tickMarket(){
    sideState.long = clamp(sideState.long + rand(-1.2, 1.2), 40, 80);
    sideState.fear = clamp(sideState.fear + rand(-4, 4), 0, 100);
  }

  function tickTables(){
    sideState.tradeRows.unshift(makeTradeRow());
    sideState.tradeRows = sideState.tradeRows.slice(0, 10);

    sideState.liqRows.unshift(makeLiqRow());
    sideState.liqRows = sideState.liqRows.slice(0, 10);
  }

  seedRows();
  renderMarket();
  renderTrade();
  renderLiq();

  setInterval(() => {
    tickMarket();
    renderMarket();
  }, 2000);

  setInterval(() => {
    tickTables();
    renderTrade();
    renderLiq();
  }, 4000);

})();
