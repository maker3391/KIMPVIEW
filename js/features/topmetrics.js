(() => {
  const PROXY = "https://kimpview-proxy.cjstn3391.workers.dev";
  const $ = (id) => document.getElementById(id);
  const TOPMETRICS_LS_KEY = "KIMPVIEW_TOPMETRICS_V1";

  function parseNum(x) {
    if (x == null) return NaN;
    if (typeof x === "number") return x;
    return Number(String(x).replace(/[^0-9.]/g, ""));
  }

  async function fetchJson(url, { timeoutMs = 12000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort("TIMEOUT"), timeoutMs);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${url} ${body.slice(0, 120)}`);
      }
      return r.json();
    } finally {
      clearTimeout(t);
    }
  }

  function validFx(v) {
    return Number.isFinite(v) && v > 1000 && v < 3000;
  }

  function setGlobalFx(v) {
    const n = parseNum(v);
    if (!validFx(n)) return false;

    window.__GLOBAL_FX_RATE = n;
    window.KIMPVIEW = window.KIMPVIEW || {};
    window.KIMPVIEW.fxKRW = n;
    return true;
  }

  function setMetricText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function formatKRW(v) {
    return Number.isFinite(v) && v > 0 ? `${Math.round(v).toLocaleString("ko-KR")}원` : "";
  }

  function formatFx(v) {
    return Number.isFinite(v) && v > 0 ? `${v.toLocaleString("ko-KR")}원` : "";
  }

  function formatPct(v) {
    return Number.isFinite(v) && v >= 0 ? `${v.toFixed(2)}%` : "";
  }

  function formatKRWJoEok(v) {
    if (!Number.isFinite(v) || v <= 0) return "";

    const abs = Math.floor(v);
    const jo = Math.floor(abs / 1e12);
    const eok = Math.floor((abs % 1e12) / 1e8);

    if (jo > 0) return `${jo}조 ${eok.toLocaleString("ko-KR")}억`;
    return `${eok.toLocaleString("ko-KR")}억`;
  }

  function restoreTopMetrics() {
    try {
      const raw = localStorage.getItem(TOPMETRICS_LS_KEY);
      if (!raw) return false;
      const obj = JSON.parse(raw);

      const fx = parseNum(obj?.fx?.value);
      setMetricText("fxKRW", formatFx(fx));
      setGlobalFx(fx);

      setMetricText("usdtKRW", formatKRW(parseNum(obj?.usdt)));
      setMetricText("btcDominance", formatPct(parseNum(obj?.dom)));

      const mcapKRW = parseNum(obj?.mcapKRW);
      const spotKRW = parseNum(obj?.spotKRW);
      const derivKRW = parseNum(obj?.derivKRW);

      if ($("totalMcap")) setMetricText("totalMcap", formatKRWJoEok(mcapKRW));
      if ($("spotVolume")) setMetricText("spotVolume", formatKRWJoEok(spotKRW));
      if ($("derivVolume")) setMetricText("derivVolume", formatKRWJoEok(derivKRW));

      return true;
    } catch {
      return false;
    }
  }

  function saveTopMetrics({ fxObj, usdt, dom, mcapKRW, spotKRW, derivKRW }) {
    try {
      localStorage.setItem(
        TOPMETRICS_LS_KEY,
        JSON.stringify({
          ts: Date.now(),
          fx: fxObj || null,
          usdt: Number.isFinite(usdt) ? usdt : 0,
          dom: Number.isFinite(dom) ? dom : 0,
          mcapKRW: Number.isFinite(mcapKRW) ? mcapKRW : 0,
          spotKRW: Number.isFinite(spotKRW) ? spotKRW : 0,
          derivKRW: Number.isFinite(derivKRW) ? derivKRW : 0,
        })
      );
    } catch {}
  }

  async function loadFxKRW() {
    const fxSources = [
      { name: "proxy-google", url: `${PROXY}/fx/google`, pick: (j) => parseNum(j?.rate) },
      { name: "er-api", url: "https://open.er-api.com/v6/latest/USD", pick: (j) => parseNum(j?.rates?.KRW) },
      { name: "frankfurter", url: "https://api.frankfurter.app/latest?from=USD&to=KRW", pick: (j) => parseNum(j?.rates?.KRW) },
    ];

    for (const s of fxSources) {
      try {
        const j = await fetchJson(s.url);
        const v = s.pick(j);
        if (validFx(v)) return { value: v, source: s.name };
      } catch {}
    }
    return { value: 0, source: "none" };
  }

  async function loadUSDTKRW() {
    try {
      const j = await fetchJson(`${PROXY}/upbit?market=KRW-USDT`, { timeoutMs: 8000 });
      const v = parseNum(j?.trade_price ?? j?.price);
      if (Number.isFinite(v) && v > 500 && v < 5000) return v;
    } catch {}

    try {
      const j = await fetchJson(`${PROXY}/bithumb/public/ticker/ALL_KRW`, { timeoutMs: 8000 });
      const v = parseNum(j?.data?.USDT?.closing_price);
      if (Number.isFinite(v) && v > 500 && v < 5000) return v;
    } catch {}

    return 0;
  }

  async function loadGlobalStats() {
    const GLOBAL_PROXY = "https://coingecko.cjstn3391.workers.dev";
    try {
      const data = await fetchJson(`${GLOBAL_PROXY}/global-stats`, { timeoutMs: 10000 });
      if (data) {
        return {
          dom: parseNum(data.btcDominance),
          mcapUsd: parseNum(data.totalMcapUsd),
          spotVolUsd: parseNum(data.spotVolUsd),
          derivVolUsd: parseNum(data.derivVolUsd),
        };
      }
    } catch (e) {
      console.error("Global Stats Load Failed:", e);
    }
    return { dom: 0, mcapUsd: 0, spotVolUsd: 0, derivVolUsd: 0 };
  }

  function usdToKrw(usd) {
    const fx = window.__GLOBAL_FX_RATE || 0;
    const u = Number(usd);
    if (!Number.isFinite(u) || u <= 0 || !fx) return 0;
    return u * fx;
  }

  async function loadTopMetrics() {
    const fxEl = $("fxKRW");
    if (!fxEl) return;

    const usdtEl = $("usdtKRW");
    const domEl = $("btcDominance");
    const mcapEl = $("totalMcap");
    const spotVolEl = $("spotVolume");
    const derivVolEl = $("derivVolume");

    const fxObj = await loadFxKRW();
    if (!validFx(fxObj.value)) return;

    setMetricText("fxKRW", formatFx(fxObj.value));
    setGlobalFx(fxObj.value);

    const [usdt, global] = await Promise.all([
      usdtEl ? loadUSDTKRW() : Promise.resolve(0),
      loadGlobalStats(),
    ]);

    if (usdtEl && Number.isFinite(usdt) && usdt > 0) {
      setMetricText("usdtKRW", formatKRW(usdt));
    }

    if (domEl && Number.isFinite(global.dom) && global.dom > 0) {
      setMetricText("btcDominance", formatPct(global.dom));
    }

    const mcapKRW = usdToKrw(global.mcapUsd);
    const spotKRW = usdToKrw(global.spotVolUsd);
    const derivKRW = usdToKrw(global.derivVolUsd);

    if (mcapEl) setMetricText("totalMcap", formatKRWJoEok(mcapKRW));
    if (spotVolEl) setMetricText("spotVolume", formatKRWJoEok(spotKRW));
    if (derivVolEl) setMetricText("derivVolume", formatKRWJoEok(derivKRW));

    saveTopMetrics({
      fxObj,
      usdt,
      dom: global.dom,
      mcapKRW,
      spotKRW,
      derivKRW,
    });
  }

  window.KIMPVIEW = window.KIMPVIEW || {};
  window.KIMPVIEW.loadTopMetrics = loadTopMetrics;

  function start() {
    restoreTopMetrics();
    loadTopMetrics();
    setInterval(loadTopMetrics, 60_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
