(() => {
  const CFG = {
    BINANCE_FAPI: "https://fapi.binance.com",
    PERIOD: "5m",
    LIMIT: 1,
    TIMEOUT_MS: 8000,
    FRED_PROXY: "https://kimpview-proxy.cjstn3391.workers.dev",
    PROXY: "",
  };

  const $ = (id) => document.getElementById(id);

  const LS_KEY = "KIMPVIEW_STATS_LS_V1";
  const MACRO_KEY = "KIMPVIEW_STATS_MACRO_V1";
  const LS_TTL = 30 * 1000;      
  const MACRO_TTL = 60 * 1000;   

  function readCache(key, ttlMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.t || !obj.data) return null;
      if (Date.now() - obj.t > ttlMs) return null;
      return obj.data;
    } catch {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
    } catch {}
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function toFixedSafe(x, digits = 2) {
    const n = Number(x);
    return Number.isFinite(n) ? n.toFixed(digits) : "";
  }

  function tsToKstString(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts));
    return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} (KST)`;
  }

  function setDualBar(longId, shortId, longPct, shortPct) {
    const longEl = $(longId);
    const shortEl = $(shortId);
    if (!longEl || !shortEl) return;
    const sum = longPct + shortPct;
    const nl = sum ? (longPct / sum) * 100 : 0;
    const ns = sum ? (shortPct / sum) * 100 : 0;
    longEl.style.width = `${nl}%`;
    shortEl.style.width = `${ns}%`;
  }

  function applySignedClass(el, x) {
    if (!el) return;
    el.classList.remove("pos", "neg", "zero");
    if (!Number.isFinite(x) || Math.abs(x) < 0.005) {
      el.classList.add("zero");
      return;
    }
    x > 0 ? el.classList.add("pos") : el.classList.add("neg");
  }

  function setDeltaAndPctText(id, latest, prev, deltaDigits = 2, pctDigits = 2) {
    const el = $(id);
    if (!el) return;
    const L = Number(latest), P = Number(prev);
    if (!Number.isFinite(L) || !Number.isFinite(P) || P === 0) {
      el.textContent = "";
      el.classList.remove("pos", "neg", "zero");
      return;
    }
    let delta = L - P;
    let pct = (delta / P) * 100;
    if (Math.abs(pct) < 0.005) { delta = 0; pct = 0; }
    applySignedClass(el, pct);
    const sign = pct > 0 ? "+" : (pct < 0 ? "" : "");
    el.textContent = `${Math.abs(delta).toFixed(deltaDigits)} (${sign}${Math.abs(pct).toFixed(pctDigits)}%)`;
  }

  function renderLSFromPayload(p) {
    if (!p) return;

    if (p.btc) {
      setText("btcLong", Number(p.btc.longPct).toFixed(0));
      setText("btcShort", Number(p.btc.shortPct).toFixed(0));
      setDualBar("btcBarLong", "btcBarShort", Number(p.btc.longPct), Number(p.btc.shortPct));
    }
    if (p.eth) {
      setText("ethLong", Number(p.eth.longPct).toFixed(0));
      setText("ethShort", Number(p.eth.shortPct).toFixed(0));
      setDualBar("ethBarLong", "ethBarShort", Number(p.eth.longPct), Number(p.eth.shortPct));
    }
    if (p.meta) {
      setText("lsSource", p.meta.source || `Binance Global Ratio (${CFG.PERIOD})`);
      setText("lsAsOf", p.meta.asOf || tsToKstString(Date.now()));
    }
  }

  function renderMacroFromPayload(p) {
    if (!p) return;

    const setTag = (id, text, cls) => {
      const el = $(id);
      if (!el) return;
      el.textContent = text;
      el.className = "";
      if (cls) el.classList.add(cls);
      el.style.display = "inline-block";
    };

    const rows = p.rows || {};

    for (const k of Object.keys(rows)) {
      const r = rows[k];
      if (!r) continue;
      if (r.valId) setText(r.valId, r.valText);
      if (r.chgId) {
        const el = $(r.chgId);
        if (el) {
          el.textContent = r.chgText ?? "";
          el.classList.remove("pos", "neg", "zero");
          if (r.cls) el.classList.add(r.cls);
        }
      }
    }

    if (p.tags) {
      if (p.tags.nasdaq) setTag("nasdaqTag", p.tags.nasdaq.text, p.tags.nasdaq.cls);
      if (p.tags.spx) setTag("spxTag", p.tags.spx.text, p.tags.spx.cls);
      if (p.tags.kospi) setTag("kospiTag", p.tags.kospi.text, p.tags.kospi.cls);
      if (p.tags.kosdaq) setTag("kosdaqTag", p.tags.kosdaq.text, p.tags.kosdaq.cls);
    }
  }

  async function updateLongShortOnce() {
    try {
      const fetchLS = async (symbol) => {
        const res = await fetch(`${CFG.BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${CFG.PERIOD}&limit=1`);
        const data = await res.json();
        return data[0];
      };

      const [btc, eth] = await Promise.all([fetchLS("BTCUSDT"), fetchLS("ETHUSDT")]);

      if (btc) {
        const longPct = btc.longAccount * 100;
        const shortPct = btc.shortAccount * 100;
        setText("btcLong", longPct.toFixed(0));
        setText("btcShort", shortPct.toFixed(0));
        setDualBar("btcBarLong", "btcBarShort", longPct, shortPct);
      }

      if (eth) {
        const longPct = eth.longAccount * 100;
        const shortPct = eth.shortAccount * 100;
        setText("ethLong", longPct.toFixed(0));
        setText("ethShort", shortPct.toFixed(0));
        setDualBar("ethBarLong", "ethBarShort", longPct, shortPct);
      }

      setText("lsSource", `Binance Global Ratio (${CFG.PERIOD})`);
      setText("lsAsOf", tsToKstString(Date.now()));

      writeCache(LS_KEY, {
        btc: btc ? { longPct: btc.longAccount * 100, shortPct: btc.shortAccount * 100 } : null,
        eth: eth ? { longPct: eth.longAccount * 100, shortPct: eth.shortAccount * 100 } : null,
        meta: { source: `Binance Global Ratio (${CFG.PERIOD})`, asOf: tsToKstString(Date.now()) }
      });
    } catch (e) {
      console.error("LS fetch failed", e);
    }
  }

  async function updateMacroOnce() {
    ["nasdaqTag", "spxTag", "kospiTag", "kosdaqTag"].forEach(id => {
      const el = $(id); if (el) el.textContent = "";
    });

    const getW = (path) => fetch(`${CFG.FRED_PROXY}${path}`).then(r => r.json());

    try {
      const [dxy, jpy, eur, us10y, vix, gold, oil, nasdaq, spx, kospi, kosdaq] = await Promise.allSettled([
        getW("/dxy"), getW("/yahoo?symbol=USDJPY=X"), getW("/yahoo?symbol=EURUSD=X"),
        getW("/us10y"), getW("/vix"), getW("/gold"), getW("/oil"),
        getW("/yahoo?symbol=^IXIC"), getW("/yahoo?symbol=^GSPC"), getW("/yahoo?symbol=^KS11"), getW("/yahoo?symbol=^KQ11")
      ]);

      const setTag = (id, text, cls) => {
        const el = $(id);
        if (!el) return;
        el.textContent = text;
        el.className = "";
        if (cls) el.classList.add(cls);
        el.style.display = "inline-block";
      };

      const getTimeParts = (timeZone) => {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour12: false,
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const parts = fmt.formatToParts(new Date());
        const obj = {};
        for (const p of parts) obj[p.type] = p.value;
        const hh = parseInt(obj.hour, 10);
        const mm = parseInt(obj.minute, 10);
        return { weekday: obj.weekday, mins: hh * 60 + mm };
      };

      const isWeekday = (w) => ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(w);

      const isUSLive = () => {
        const t = getTimeParts("America/New_York");
        if (!isWeekday(t.weekday)) return false;
        const open = 9 * 60 + 30;
        const close = 16 * 60;
        return t.mins >= open && t.mins < close;
      };

      const isKRLive = () => {
        const t = getTimeParts("Asia/Seoul");
        if (!isWeekday(t.weekday)) return false;
        const open = 9 * 60;
        const close = 15 * 60 + 30;
        return t.mins >= open && t.mins < close;
      };

      const payload = { rows: {}, tags: {} };

      const render = (key, idVal, idChg, res, digits = 2) => {
        if (res.status !== "fulfilled" || !res.value) return;
        const d = res.value;
        const latest = d.latest || d.price;
        const prev = d.prev || d.prevClose;

        setText(idVal, toFixedSafe(latest, digits));
        setDeltaAndPctText(idChg, latest, prev, digits);

        // snapshot for cache
        const chgEl = $(idChg);
        let cls = null;
        if (chgEl) {
          if (chgEl.classList.contains("pos")) cls = "pos";
          else if (chgEl.classList.contains("neg")) cls = "neg";
          else if (chgEl.classList.contains("zero")) cls = "zero";
        }
        payload.rows[key] = {
          valId: idVal,
          chgId: idChg,
          valText: $(idVal)?.textContent ?? "",
          chgText: $(idChg)?.textContent ?? "",
          cls
        };
      };

      render("dxy", "dxyValue", "dxyChange", dxy);
      render("jpy", "jpyxValue", "jpyxChange", jpy);
      render("eur", "eurxValue", "eurxChange", eur, 4);

      if (us10y.status === "fulfilled" && us10y.value) {
        const d = us10y.value;
        let latest = Number(d.latest || d.price);
        let prev = Number(d.prev || d.prevClose);

        if (latest > 10) { latest /= 10; prev /= 10; }
        else if (latest > 0 && latest < 1) { latest *= 10; prev *= 10; }

        setText("us10yValue", toFixedSafe(latest, 2));
        setDeltaAndPctText("us10yChange", latest, prev, 2);

        const chgEl = $("us10yChange");
        let cls = null;
        if (chgEl) {
          if (chgEl.classList.contains("pos")) cls = "pos";
          else if (chgEl.classList.contains("neg")) cls = "neg";
          else if (chgEl.classList.contains("zero")) cls = "zero";
        }
        payload.rows["us10y"] = {
          valId: "us10yValue",
          chgId: "us10yChange",
          valText: $("us10yValue")?.textContent ?? "",
          chgText: $("us10yChange")?.textContent ?? "",
          cls
        };
      }

      render("vix", "vixValue", "vixChange", vix);
      render("gold", "goldValue", "goldChange", gold);
      render("oil", "wtiValue", "wtiChange", oil);
      render("nasdaq", "nasdaqValue", "nasdaqChange", nasdaq);
      render("spx", "spxValue", "spxChange", spx);
      render("kospi", "kospiValue", "kospiChange", kospi);
      render("kosdaq", "kosdaqValue", "kosdaqChange", kosdaq);

      const usLive = isUSLive();
      const krLive = isKRLive();

      setTag("nasdaqTag", usLive ? "LIVE" : "CLOSE", usLive ? "tagLive" : "tagClose");
      setTag("spxTag", usLive ? "LIVE" : "CLOSE", usLive ? "tagLive" : "tagClose");
      setTag("kospiTag", krLive ? "LIVE" : "CLOSE", krLive ? "tagLive" : "tagClose");
      setTag("kosdaqTag", krLive ? "LIVE" : "CLOSE", krLive ? "tagLive" : "tagClose");

      payload.tags = {
        nasdaq: { text: usLive ? "LIVE" : "CLOSE", cls: usLive ? "tagLive" : "tagClose" },
        spx: { text: usLive ? "LIVE" : "CLOSE", cls: usLive ? "tagLive" : "tagClose" },
        kospi: { text: krLive ? "LIVE" : "CLOSE", cls: krLive ? "tagLive" : "tagClose" },
        kosdaq: { text: krLive ? "LIVE" : "CLOSE", cls: krLive ? "tagLive" : "tagClose" },
      };

      writeCache(MACRO_KEY, payload);
    } catch (e) {
      console.error("Macro failed", e);
    }
  }
  function hidePastCalendarItems() {
    const now = Date.now();

    document.querySelectorAll(".calendarItem[data-datetime]").forEach(item => {
      const dt = item.getAttribute("data-datetime");
      if (!dt) return;

      const t = new Date(dt).getTime();
      if (!Number.isFinite(t)) return;

      if (t < now) {
        item.style.display = "none";
      } else {
        item.style.display = ""; 
      }
    });
  }
  function boot() {
    const cachedLS = readCache(LS_KEY, LS_TTL);
    if (cachedLS) renderLSFromPayload(cachedLS);

    const cachedMacro = readCache(MACRO_KEY, MACRO_TTL);
    if (cachedMacro) renderMacroFromPayload(cachedMacro);


    hidePastCalendarItems();
    setInterval(hidePastCalendarItems, 60 * 1000); 

    updateLongShortOnce();
    updateMacroOnce();

    setInterval(updateLongShortOnce, 30000);
    setInterval(updateMacroOnce, 60000);
  }

  boot();
})();
