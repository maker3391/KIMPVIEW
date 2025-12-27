(() => {
  const CFG = {
    BINANCE_FAPI: "https://fapi.binance.com",
    PERIOD: "5m",
    LIMIT: 1,
    TIMEOUT_MS: 8000,

    // Cloudflare Worker
    FRED_PROXY: "https://kimpview-proxy.cjstn3391.workers.dev",

    // Optional upstream proxy wrapper
    PROXY: "",
  };

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function toFixedSafe(x, digits = 2) {
    const n = Number(x);
    if (!Number.isFinite(n)) return "-";
    return n.toFixed(digits);
  }

  function tsToKstString(ts) {
    if (!ts) return "-";
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return "-";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}.${mm}.${dd} ${hh}:${mi} (KST)`;
  }

  function setDualBar(longId, shortId, longPct, shortPct) {
    const longEl = $(longId);
    const shortEl = $(shortId);
    if (!longEl || !shortEl) return;

    const l = clamp(longPct, 0, 100);
    const s = clamp(shortPct, 0, 100);
    const sum = l + s;

    const nl = sum ? (l / sum) * 100 : 0;
    const ns = sum ? (s / sum) * 100 : 0;

    longEl.style.width = `${nl}%`;
    shortEl.style.width = `${ns}%`;
  }

  // ---------- + / - / 0 class & text ----------
  function applySignedClass(el, x) {
    if (!el) return;
    el.classList.remove("pos", "neg", "zero");
    if (!Number.isFinite(x)) return;
    if (x > 0) el.classList.add("pos");
    else if (x < 0) el.classList.add("neg");
    else el.classList.add("zero");
  }

  function setSignedPctText(id, pct, digits = 2) {
    const el = $(id);
    if (!el) return;
    if (!Number.isFinite(pct)) {
      el.textContent = "-";
      el.classList.remove("pos", "neg", "zero");
      return;
    }
    applySignedClass(el, pct);
    el.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
  }

  function setDeltaAndPctText(id, latest, prev, deltaDigits = 2, pctDigits = 2) {
    const el = $(id);
    if (!el) return;

    const L = Number(latest);
    const P = Number(prev);

    if (!Number.isFinite(L) || !Number.isFinite(P) || P === 0) {
      el.textContent = "-";
      el.classList.remove("pos", "neg", "zero");
      return;
    }

    const delta = L - P;
    const pct = ((L - P) / P) * 100;

    applySignedClass(el, delta);
    const deltaText = Math.abs(delta).toFixed(deltaDigits);
    const pctText = `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(pctDigits)}%`;

    el.textContent = `${deltaText} (${pctText})`;
  }

  // ---------- LIVE / CLOSE badge ----------
  function getTodayInTimeZone(tz) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    return new Date(y, m - 1, d);
  }

  function parseYmdToDate(ymd) {
    if (!ymd || typeof ymd !== "string") return null;
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function isSameYmd(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function setMarketBadge(tagId, market, dateStr) {
    const el = $(tagId);
    if (!el) return;

    el.classList.remove("badge-live", "badge-close");
    el.textContent = "-";

    const d = parseYmdToDate(dateStr);
    if (!d) return;

    const today =
      market === "US"
        ? getTodayInTimeZone("America/New_York")
        : getTodayInTimeZone("Asia/Seoul");

    if (isSameYmd(d, today)) {
      el.textContent = "LIVE";
      el.classList.add("badge-live");
    } else {
      el.textContent = "CLOSE";
      el.classList.add("badge-close");
    }
  }

  // ---------- fetch with timeout ----------
  async function fetchJson(url, { timeoutMs = CFG.TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const finalUrl = CFG.PROXY ? CFG.PROXY + encodeURIComponent(url) : url;
      const res = await fetch(finalUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // ---------- Binance Long/Short ----------
  async function getBinanceGlobalLongShort(symbol) {
    const qs = new URLSearchParams({
      symbol,
      period: CFG.PERIOD,
      limit: String(CFG.LIMIT),
    });

    const url = `${CFG.BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?${qs.toString()}`;
    const data = await fetchJson(url);

    if (!Array.isArray(data) || data.length === 0) return null;

    const row = data[data.length - 1];
    const longAcc = Number(row.longAccount);
    const shortAcc = Number(row.shortAccount);
    const ts = Number(row.timestamp);

    if (!Number.isFinite(longAcc) || !Number.isFinite(shortAcc)) return null;

    return { longPct: longAcc * 100, shortPct: shortAcc * 100, ts };
  }

  function renderLongShort({ btc, eth, sourceName }) {
    if (btc) {
      setText("btcLong", toFixedSafe(btc.longPct, 0));
      setText("btcShort", toFixedSafe(btc.shortPct, 0));
      setDualBar("btcBarLong", "btcBarShort", btc.longPct, btc.shortPct);
    } else {
      setText("btcLong", "-");
      setText("btcShort", "-");
      setDualBar("btcBarLong", "btcBarShort", 0, 0);
    }

    if (eth) {
      setText("ethLong", toFixedSafe(eth.longPct, 0));
      setText("ethShort", toFixedSafe(eth.shortPct, 0));
      setDualBar("ethBarLong", "ethBarShort", eth.longPct, eth.shortPct);
    } else {
      setText("ethLong", "-");
      setText("ethShort", "-");
      setDualBar("ethBarLong", "ethBarShort", 0, 0);
    }

    const ts = Math.max(btc?.ts || 0, eth?.ts || 0);
    setText("lsSource", sourceName || "-");
    setText("lsAsOf", ts ? tsToKstString(ts) : "-");
  }

  async function updateLongShortOnce() {
    const sourceName = `Binance USDⓈ-M (Global Account Ratio, ${CFG.PERIOD})`;
    try {
      const [btc, eth] = await Promise.all([
        getBinanceGlobalLongShort("BTCUSDT"),
        getBinanceGlobalLongShort("ETHUSDT"),
      ]);
      renderLongShort({ btc, eth, sourceName });
    } catch (e) {
      renderLongShort({ btc: null, eth: null, sourceName: "연결 실패 (Binance)" });
      console.warn("[stats.js] long/short fetch failed:", e);
    }
  }

  // ---------- Worker endpoints ----------
  async function getWorker(path) {
    const url = `${CFG.FRED_PROXY}${path}`;
    return await fetchJson(url); 
  }

  // ---------- US10Y scale fix ----------
  function fixPercentScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return n;
    if (n > 0 && n < 1) return n * 100;
    return n;
  }

  // ---------- render series ----------
  function renderSeries({
    valueId,
    changeId,
    digits = 2,
    deltaDigits = 2,
    unitSuffix = "",
    series,
    transform,
  }) {
    if (!series) {
      setText(valueId, "-");
      if (changeId) setText(changeId, "-");
      return;
    }

    const t = typeof transform === "function" ? transform : (x) => x;

    const latest = t(series.latest);
    const prev = t(series.prev);

    setText(valueId, `${toFixedSafe(latest, digits)}${unitSuffix}`);

    if (changeId) {
      setDeltaAndPctText(changeId, latest, prev, deltaDigits, 2);
    }
  }

  async function updateMacroOnce() {
    try {
      const jobs = {
        // FX / Macro 
        dxy: getWorker("/dxy"),
        jpy: getWorker("/yahoo?symbol=USDJPY=X"),
        eur: getWorker("/yahoo?symbol=EURUSD=X"),

        // Rates / Vol / Commodities
        us10y: getWorker("/us10y"),
        vix: getWorker("/vix"),
        gold: getWorker("/gold"),
        oil: getWorker("/oil"),

        // Equity
        nasdaq: getWorker("/yahoo?symbol=^IXIC"),
        spx: getWorker("/yahoo?symbol=^GSPC"),
        kospi: getWorker("/yahoo?symbol=^KS11"),
        kosdaq: getWorker("/yahoo?symbol=^KQ11"),
      };

      const keys = Object.keys(jobs);
      const results = await Promise.allSettled(Object.values(jobs));
      const out = {};
      results.forEach((r, i) => {
        out[keys[i]] = r.status === "fulfilled" ? r.value : null;
      });

      // FX
      renderSeries({
        valueId: "dxyValue",
        changeId: "dxyChange",
        digits: 2,
        deltaDigits: 2,
        series: out.dxy,
      });
      renderSeries({
        valueId: "jpyxValue",
        changeId: "jpyxChange",
        digits: 2,
        deltaDigits: 2,
        series: out.jpy,
      });
      renderSeries({
        valueId: "eurxValue",
        changeId: "eurxChange",
        digits: 4,
        deltaDigits: 4,
        series: out.eur,
      });

      // US10Y 
      renderSeries({
        valueId: "us10yValue",
        changeId: "us10yChange",
        digits: 2,
        deltaDigits: 2,
        unitSuffix: "",
        series: out.us10y,
        transform: fixPercentScale,
      });

      // VIX / GOLD / OIL
      renderSeries({
        valueId: "vixValue",
        changeId: "vixChange",
        digits: 2,
        deltaDigits: 2,
        series: out.vix,
      });
      renderSeries({
        valueId: "goldValue",
        changeId: "goldChange",
        digits: 2,
        deltaDigits: 2,
        series: out.gold,
      });
      renderSeries({
        valueId: "wtiValue",
        changeId: "wtiChange",
        digits: 2,
        deltaDigits: 2,
        series: out.oil,
      });

      // Equity
      renderSeries({
        valueId: "nasdaqValue",
        changeId: "nasdaqChange",
        digits: 2,
        deltaDigits: 2,
        series: out.nasdaq,
      });
      renderSeries({
        valueId: "spxValue",
        changeId: "spxChange",
        digits: 2,
        deltaDigits: 2,
        series: out.spx,
      });
      renderSeries({
        valueId: "kospiValue",
        changeId: "kospiChange",
        digits: 2,
        deltaDigits: 2,
        series: out.kospi,
      });
      renderSeries({
        valueId: "kosdaqValue",
        changeId: "kosdaqChange",
        digits: 2,
        deltaDigits: 2,
        series: out.kosdaq,
      });

      // LIVE/CLOSE badge
      setMarketBadge("nasdaqTag", "US", out.nasdaq?.date);
      setMarketBadge("spxTag", "US", out.spx?.date);
      setMarketBadge("kospiTag", "KR", out.kospi?.date);
      setMarketBadge("kosdaqTag", "KR", out.kosdaq?.date);
    } catch (e) {
      [
        "dxyValue",
        "dxyChange",
        "jpyxValue",
        "jpyxChange",
        "eurxValue",
        "eurxChange",
        "us10yValue",
        "us10yChange",
        "vixValue",
        "vixChange",
        "goldValue",
        "goldChange",
        "wtiValue",
        "wtiChange",
        "nasdaqValue",
        "nasdaqChange",
        "spxValue",
        "spxChange",
        "kospiValue",
        "kospiChange",
        "kosdaqValue",
        "kosdaqChange",
        "nasdaqTag",
        "spxTag",
        "kospiTag",
        "kosdaqTag",
      ].forEach((id) => setText(id, "-"));
      console.warn("[stats.js] macro fetch failed:", e);
    }
  }

  // ---------- boot ----------
  function boot() {
    renderLongShort({ btc: null, eth: null, sourceName: "-" });

    updateLongShortOnce();
    setInterval(updateLongShortOnce, 60_000);

    updateMacroOnce();
    setInterval(updateMacroOnce, 300_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
