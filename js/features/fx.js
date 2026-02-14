(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const elAmount = $("#fxAmount");
  const elResult = $("#fxResult");

  const elRateMain = $("#fxRateMain");
  const elUpdatedAt = $("#fxUpdatedAt");

  const elFromBtn = $("#fxFromBtn");
  const elToBtn = $("#fxToBtn");
  const elSwapBtn = $("#fxSwapBtn");

  const elFromDrop = $("#fxFromDrop");
  const elToDrop = $("#fxToDrop");
  const elBackdrop = $("#fxBackdrop");

  const elFromSearch = $("#fxFromSearch");
  const elToSearch = $("#fxToSearch");
  const elFromList = $("#fxFromList");
  const elToList = $("#fxToList");

  const elFromFlag = $("#fxFromFlag");
  const elToFlag = $("#fxToFlag");
  const elFromCode = $("#fxFromCode");
  const elToCode = $("#fxToCode");

  if (!elAmount || !elResult || !elFromBtn || !elToBtn) return;

  const CURRENCIES = [
    { code: "KRW", name: "대한민국 원", symbol: "₩", flag: "🇰🇷" },
    { code: "USD", name: "미국 달러", symbol: "$", flag: "🇺🇸" },
    { code: "JPY", name: "일본 엔", symbol: "¥", flag: "🇯🇵" },
    { code: "CNY", name: "중국 위안", symbol: "¥", flag: "🇨🇳" },
    { code: "HKD", name: "홍콩 달러", symbol: "$", flag: "🇭🇰" },
    { code: "SGD", name: "싱가포르 달러", symbol: "$", flag: "🇸🇬" },

    { code: "EUR", name: "유로", symbol: "€", flag: "🇪🇺" },
    { code: "GBP", name: "영국 파운드", symbol: "£", flag: "🇬🇧" },
    { code: "CHF", name: "스위스 프랑", symbol: "CHF", flag: "🇨🇭" },

    { code: "AUD", name: "호주 달러", symbol: "$", flag: "🇦🇺" },
    { code: "CAD", name: "캐나다 달러", symbol: "$", flag: "🇨🇦" },
    { code: "NZD", name: "뉴질랜드 달러", symbol: "$", flag: "🇳🇿" },

    { code: "VND", name: "베트남 동", symbol: "₫", flag: "🇻🇳" },
    { code: "THB", name: "태국 바트", symbol: "฿", flag: "🇹🇭" },
    { code: "PHP", name: "필리핀 페소", symbol: "₱", flag: "🇵🇭" },
    { code: "IDR", name: "인도네시아 루피아", symbol: "Rp", flag: "🇮🇩" },
    { code: "MYR", name: "말레이시아 링깃", symbol: "RM", flag: "🇲🇾" },

    { code: "INR", name: "인도 루피", symbol: "₹", flag: "🇮🇳" },
    { code: "TWD", name: "대만 달러", symbol: "$", flag: "🇹🇼" },

    { code: "TRY", name: "터키 리라", symbol: "₺", flag: "🇹🇷" },
    { code: "RUB", name: "러시아 루블", symbol: "₽", flag: "🇷🇺" },

    { code: "BRL", name: "브라질 레알", symbol: "R$", flag: "🇧🇷" },
    { code: "MXN", name: "멕시코 페소", symbol: "$", flag: "🇲🇽" },

    { code: "AED", name: "아랍에미리트 디르함", symbol: "د.إ", flag: "🇦🇪" },
    { code: "SAR", name: "사우디 리얄", symbol: "﷼", flag: "🇸🇦" }
  ];

  const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));
  const normalize = (s) => String(s || "").toLowerCase().trim();

  function emojiToTwemojiUrl(emoji) {
    const cps = Array.from(emoji || "")
      .map((ch) => ch.codePointAt(0).toString(16))
      .join("-");
    return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${cps}.svg`;
  }

  function renderFlag(emoji, altText = "") {
    const e = emoji || "🏳️";
    const url = emojiToTwemojiUrl(e);
    return `<img class="fxFlagImg" src="${url}" alt="${altText}" loading="lazy">`;
  }

  const state = {
    from: "KRW",
    to: "USD",
    rates: null,
    updatedAt: null,
    openDrop: null,
    inflight: null
  };

  const CACHE_KEY = "KIMPVIEW_FX_RATES_USD_V1";
  const TTL = 10 * 60 * 1000;

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.t || !obj.rates) return null;
      if (Date.now() - obj.t > TTL) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function writeCache(rates, time_last_update_utc) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          t: Date.now(),
          rates,
          time_last_update_utc: time_last_update_utc || null
        })
      );
    } catch {}
  }

  async function loadRatesUSD() {
    if (state.rates) return state.rates;
    if (state.inflight) return state.inflight;

    const cached = readCache();
    if (cached?.rates) {
      state.rates = cached.rates;
      state.updatedAt = cached.time_last_update_utc || null;
      return state.rates;
    }

    state.inflight = fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data || data.result !== "success" || !data.rates) {
          throw new Error("환율 API 응답 오류");
        }
        state.rates = data.rates;
        state.updatedAt = data.time_last_update_utc || null;
        writeCache(state.rates, state.updatedAt);
        return state.rates;
      })
      .finally(() => {
        state.inflight = null;
      });

    return state.inflight;
  }

  function fmtNumber(n, code) {
    if (!Number.isFinite(n)) return "";
    const noDecimals = new Set(["VND", "IDR", "KRW", "JPY"]);
    const maxFrac = noDecimals.has(code) ? 0 : 2;
    return n.toLocaleString("ko-KR", { maximumFractionDigits: maxFrac });
  }

  function formatUpdatedAt(utcString) {
    if (!utcString) return "";
    const d = new Date(utcString);
    if (isNaN(d)) return "";

    const kst = d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });

    return `기준 시각: ${kst} (KST)`;
  }

  function getRate(base, quote) {
    const rates = state.rates;
    if (!rates) return null;

    const b = rates[base];
    const q = rates[quote];

    const baseRate = base === "USD" ? 1 : b;
    const quoteRate = quote === "USD" ? 1 : q;

    if (!baseRate || !quoteRate) return null;
    return quoteRate / baseRate;
  }

  function parseAmount(str) {
    const s = String(str || "").replace(/,/g, "").trim();
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function updateTopLine() {
    const ref = state.from && state.from !== "KRW" ? state.from : state.to;

    if (!ref || ref === "KRW") {
      elRateMain.textContent = "";
      elUpdatedAt.textContent = state.updatedAt ? formatUpdatedAt(state.updatedAt) : "";
      return;
    }

    let unit = 1;
    if (ref === "JPY") unit = 100;
    if (ref === "VND" || ref === "IDR") unit = 1000;

    const rate = getRate(ref, "KRW");
    if (!Number.isFinite(rate)) {
      elRateMain.textContent = "";
      elUpdatedAt.textContent = state.updatedAt ? formatUpdatedAt(state.updatedAt) : "";
      return;
    }

    const v = unit * rate;
    const shown = v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

    elRateMain.textContent = `${unit.toLocaleString("ko-KR")} ${ref} = ${shown} KRW`;
    elUpdatedAt.textContent = state.updatedAt ? formatUpdatedAt(state.updatedAt) : "";
  }

  function updateResult() {
    const amount = parseAmount(elAmount.value);
    if (!Number.isFinite(amount)) {
      elResult.value = "";
      return;
    }

    const rate = getRate(state.from, state.to);
    if (!Number.isFinite(rate)) {
      elResult.value = "";
      return;
    }

    const converted = amount * rate;
    elResult.value = fmtNumber(converted, state.to);
  }

  function setCurrency(which, code) {
    if (!byCode.has(code)) return;

    if (which === "from") state.from = code;
    else state.to = code;

    const c = byCode.get(code);

    if (which === "from") {
      elFromFlag.innerHTML = renderFlag(c.flag, c.code);
      elFromCode.textContent = `${c.symbol} ${c.code}`;
    } else {
      elToFlag.innerHTML = renderFlag(c.flag, c.code);
      elToCode.textContent = `${c.symbol} ${c.code}`;
    }

    updateTopLine();
    updateResult();

    renderList("from", elFromSearch.value);
    renderList("to", elToSearch.value);
  }

  function openDrop(which) {
    state.openDrop = which;
    elBackdrop.classList.remove("fxHidden");

    if (which === "from") {
      elFromDrop.classList.remove("fxHidden");
      elToDrop.classList.add("fxHidden");
      elFromSearch.value = "";
      renderList("from", "");
      setTimeout(() => elFromSearch.focus(), 0);
    } else {
      elToDrop.classList.remove("fxHidden");
      elFromDrop.classList.add("fxHidden");
      elToSearch.value = "";
      renderList("to", "");
      setTimeout(() => elToSearch.focus(), 0);
    }
  }

  function closeDrop() {
    state.openDrop = null;
    elFromDrop.classList.add("fxHidden");
    elToDrop.classList.add("fxHidden");
    elBackdrop.classList.add("fxHidden");
  }

  function renderList(which, keyword) {
    const listEl = which === "from" ? elFromList : elToList;
    const selected = which === "from" ? state.from : state.to;

    const k = normalize(keyword);
    const filtered = CURRENCIES.filter((c) => {
      if (!k) return true;
      const hay = normalize(`${c.code} ${c.name}`);
      return hay.includes(k);
    });

    listEl.innerHTML = filtered
      .map((c) => {
        const isSel = c.code === selected;
        return `
        <div class="fxItem ${isSel ? "isSelected" : ""}" role="option" data-code="${c.code}" aria-selected="${isSel}">
          <div class="fxItemLeft">
            <span class="fxItemFlag">${renderFlag(c.flag, c.code)}</span>
            <div class="fxItemText">
              <div class="fxItemCode">${c.symbol || c.code} ${c.code}</div>
              <div class="fxItemName">${c.name}</div>
            </div>
          </div>
          <div class="fxItemCheck">✔</div>
        </div>
      `;
      })
      .join("");
  }

  function onListClick(e, which) {
    const item = e.target.closest(".fxItem");
    if (!item) return;
    const code = item.getAttribute("data-code");
    if (!code) return;
    setCurrency(which, code);
    closeDrop();
  }

  function formatAmountInputKeepCursor(inputEl) {
    const raw = inputEl.value;
    const start = inputEl.selectionStart ?? raw.length;

    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const intPartRaw = parts[0] || "";
    const decPartRaw = parts.length > 1 ? parts.slice(1).join("") : null;

    const intDigits = intPartRaw.replace(/^0+(?=\d)/, "");
    const intFormatted = intDigits ? Number(intDigits).toLocaleString("ko-KR") : "";

    const decPart = decPartRaw !== null ? decPartRaw.slice(0, 8) : null;
    const formatted = decPart !== null ? `${intFormatted}.${decPart}` : intFormatted;

    const digitsBeforeCursor = raw.slice(0, start).replace(/[^0-9.]/g, "").length;

    inputEl.value = formatted;

    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < digitsBeforeCursor) {
      if (/[0-9.]/.test(formatted[pos])) seen++;
      pos++;
    }
    inputEl.setSelectionRange(pos, pos);
  }

  elFromBtn.addEventListener("click", () => openDrop("from"));
  elToBtn.addEventListener("click", () => openDrop("to"));

  elBackdrop.addEventListener("click", closeDrop);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fx-close]");
    if (!btn) return;
    closeDrop();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrop();
  });

  elFromSearch.addEventListener("input", () => renderList("from", elFromSearch.value));
  elToSearch.addEventListener("input", () => renderList("to", elToSearch.value));

  elFromList.addEventListener("click", (e) => onListClick(e, "from"));
  elToList.addEventListener("click", (e) => onListClick(e, "to"));

  elSwapBtn.addEventListener("click", () => {
    const a = state.from;
    const b = state.to;
    setCurrency("from", b);
    setCurrency("to", a);
  });

  elAmount.addEventListener("input", () => {
    formatAmountInputKeepCursor(elAmount);
    updateResult();
  });

  elAmount.addEventListener("blur", () => {
    formatAmountInputKeepCursor(elAmount);
    updateResult();
  });

  async function init() {
    setCurrency("from", state.from);
    setCurrency("to", state.to);

    try {
      await loadRatesUSD();
      updateTopLine();
      updateResult();
    } catch (err) {
      elRateMain.textContent = "환율 데이터를 불러오지 못했습니다.";
      elUpdatedAt.textContent = "";
      elResult.value = "";
      console.error(err);
    }
  }

  init();
})();
