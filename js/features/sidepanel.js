(() => {
  const $longRate = document.getElementById("longRate");
  const $shortRate = document.getElementById("shortRate");
  const $fearGreed = document.getElementById("fearGreed");

  const $tradeAlertBody = document.getElementById("tradeAlertBody");
  const $liquidAlertBody = document.getElementById("liquidAlertBody");

  const ALERT_SYMBOLS = ["BTC", "ETH", "XRP", "SOL", "DOGE", "BNB", "SUI", "ADA", "BCH", "TRX", "LTC"];

  const TRADE_MIN_KRW = 80_000_000;
  const LIQ_MIN_KRW = 100_000;
  const COOLDOWN_MS = 1500;

  const lastHitTrade = new Map();
  const lastHitLiq = new Map();

  let sideState = { tradeRows: [], liqRows: [] };

  const STORAGE = sessionStorage;

  const LS_TRADE_KEY = "kimpview:side:tradeRows:v1";
  const LS_LIQ_KEY = "kimpview:side:liqRows:v1";

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function nowTime() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fetchJsonWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .finally(() => clearTimeout(id));
  }

  function formatKoreanMoneyKRW(amount) {
    if (!amount) return "";
    if (amount >= 1e8) return (amount / 1e8).toFixed(2) + "억";
    if (amount >= 1e4) return (amount / 1e4).toFixed(0) + "만";
    return Math.round(amount).toLocaleString("ko-KR");
  }

  function toKrwByUsdt(usdLike) {
    const rate = Number(window.__USDT_KRW || window.__FX_KRW || 0);
    if (!rate || !Number.isFinite(rate)) return 0;
    return usdLike * rate;
  }

  function passCooldown(map, sym) {
    const now = Date.now();
    const prev = map.get(sym) || 0;
    if (now - prev < COOLDOWN_MS) return false;
    map.set(sym, now);
    return true;
  }

  function makeEmptyRow() {
    return { sym: "", type: "", label: null, amount: null, price: null, time: null };
  }

  function safeParseArray(raw) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  }

  function normalizeRows(arr, maxLen = 3) {
    const safe = Array.isArray(arr) ? arr : [];
    const out = safe
      .filter(Boolean)
      .map((r) => ({
        sym: String(r?.sym || ""),
        type: String(r?.type || ""),
        label: (r?.label == null ? null : String(r.label)),
        amount: (r?.amount == null ? null : Number(r.amount)),
        price: (r?.price == null ? null : Number(r.price)),
        time: (r?.time == null ? null : String(r.time)),
      }))
      .slice(0, maxLen);

    while (out.length < maxLen) out.push(makeEmptyRow());
    return out;
  }

  function saveSideRows() {
    try { STORAGE.setItem(LS_TRADE_KEY, JSON.stringify(sideState.tradeRows)); } catch {}
    try { STORAGE.setItem(LS_LIQ_KEY, JSON.stringify(sideState.liqRows)); } catch {}
  }

  function restoreSideRows() {
    const tradeRaw = STORAGE.getItem(LS_TRADE_KEY);
    const liqRaw = STORAGE.getItem(LS_LIQ_KEY);

    const tradeArr = tradeRaw ? safeParseArray(tradeRaw) : null;
    const liqArr = liqRaw ? safeParseArray(liqRaw) : null;

    sideState.tradeRows = normalizeRows(tradeArr, 3);
    sideState.liqRows = normalizeRows(liqArr, 3);
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
                  src="/images/binance.png"
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
    sideState.tradeRows = normalizeRows(sideState.tradeRows, 3);
    saveSideRows();
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
    sideState.liqRows = normalizeRows(sideState.liqRows, 3);
    saveSideRows();
    renderLiq();
  }

  function setCollapse(btn, body, storageKey, collapsed) {
    body.classList.toggle("is-collapsed", collapsed);
    btn.classList.toggle("rot", collapsed);
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    STORAGE.setItem(storageKey, collapsed ? "1" : "0");
  }

  function bindCollapseById(toggleId, bodyId, storageKey) {
    const btn = document.getElementById(toggleId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return;

    const saved = STORAGE.getItem(storageKey) === "1";
    setCollapse(btn, body, storageKey, saved);

    btn.addEventListener("click", () => {
      const next = !body.classList.contains("is-collapsed");
      setCollapse(btn, body, storageKey, next);
    });
  }

  function bindAlertCollapse() {
    const btns = document.querySelectorAll(".collapseBtn[data-target]");
    if (btns.length > 0) {
      btns.forEach((btn) => {
        const key = String(btn.dataset.target || "");
        const bodyId = (key === "trade") ? "tradeBody" : (key === "liq") ? "liqBody" : "";
        const body = bodyId ? document.getElementById(bodyId) : null;
        if (!body) return;

        const storageKey = `kimpview:${key}Collapsed`;
        const saved = STORAGE.getItem(storageKey) === "1";
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

  async function loadMarketStatus() {
    if (!$longRate || !$shortRate || !$fearGreed) return;

    try {
      const url = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d&limit=1";
      const arr = await fetchJsonWithTimeout(url, 7000);

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
      const j = await fetchJsonWithTimeout("https://api.alternative.me/fng/?limit=1", 7000);
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
      renderTrade();
      renderLiq();
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

    wsFutures.onerror = () => {};

    wsFutures.onclose = () => {
      const wait = Math.min(10_000, 800 * Math.pow(1.6, wsRetry++));
      setTimeout(connectFuturesWS, wait);
    };
  }

  function init() {
    bindAlertCollapse();

    restoreSideRows();
    renderTrade();
    renderLiq();

    loadMarketStatus();
    setInterval(loadMarketStatus, 60_000);

    connectFuturesWS();
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
