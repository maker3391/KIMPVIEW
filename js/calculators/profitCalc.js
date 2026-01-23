(() => {
  "use strict";

  const root = document.getElementById("profitCalc");
  if (!root) return;

  const $ = (sel) => root.querySelector(sel);

  const feeEl = $("#pf_fee");
  const taxEl = $("#pf_tax");

  const buyPriceEl = $("#pf_buyPrice");
  const sellQtyEl = $("#pf_sellQty");
  const sellPriceEl = $("#pf_sellPrice");

  const buyTotalHidden = $("#pf_buyTotal");
  const sellTotalHidden = $("#pf_sellTotal");
  const feeTotalHidden = $("#pf_feeTotal");
  const taxTotalHidden = $("#pf_taxTotal");
  const pnlHidden = $("#pf_pnl");
  const roiHidden = $("#pf_roi");

  const pnlTextEl = $("#pf_pnlText");
  const roiBadgeEl = $("#pf_roiBadge");
  const buyTotalTextEl = $("#pf_buyTotalText");
  const sellTotalTextEl = $("#pf_sellTotalText");
  const feeTotalTextEl = $("#pf_feeTotalText");
  const taxTotalTextEl = $("#pf_taxTotalText");
  const feeRateTextEl = $("#pf_feeRateText");
  const taxRateTextEl = $("#pf_taxRateText");

  const btnSave = $("#pf_save");
  const btnReset = $("#pf_reset");
  const btnClearHistory = $("#pf_clearHistory");

  const tbody = $("#pf_tbody");

  const LS_KEY = "KIMPVIEW_PROFIT_HISTORY_V1";
  const MAX_HISTORY = 200;

  function toNumber(v) {
    if (v == null) return 0;
    const s = String(v).replace(/[^\d.-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function formatInt(n) {
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(Math.round(n));
    return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatMoney(n) {
    return `${formatInt(n)}원`;
  }

  function formatQty(n) {
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    const rounded =
      abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return sign + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatPercent(n) {
    if (!Number.isFinite(n)) return "0.00%";
    const sign = n < 0 ? "-" : "";
    return `${sign}${Math.abs(n).toFixed(2)}%`;
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function setHidden(el, val) {
    if (el) el.value = String(val);
  }

  function formatCommaIntString(raw) {
    const s = String(raw ?? "").replace(/[^\d]/g, "");
    if (!s) return "";
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function applyCommaWhileTyping(inputEl) {
    if (!inputEl) return;

    const before = inputEl.value;
    const pos = inputEl.selectionStart ?? before.length;

    const leftDigits = before.slice(0, pos).replace(/[^\d]/g, "").length;

    const formatted = formatCommaIntString(before);
    inputEl.value = formatted;

    let newPos = formatted.length;
    if (leftDigits === 0) newPos = 0;
    else {
      let count = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) count++;
        if (count === leftDigits) { newPos = i + 1; break; }
      }
    }
    inputEl.setSelectionRange(newPos, newPos);
  }

  function getRatePercent(inputEl, fallback) {
    const raw = inputEl ? inputEl.value : "";
    if (!raw.trim()) return fallback;
    return clamp(toNumber(raw), 0, 100);
  }

  function compute() {
    const buyPrice = toNumber(buyPriceEl?.value);
    const sellQty = toNumber(sellQtyEl?.value);
    const sellPrice = toNumber(sellPriceEl?.value);

    const feeRatePct = getRatePercent(feeEl, 0.015);
    const taxRatePct = getRatePercent(taxEl, 0.2);

    const buyTotal = buyPrice * sellQty;
    const sellTotal = sellPrice * sellQty;

    const feeTotal = (buyTotal + sellTotal) * (feeRatePct / 100);
    const taxTotal = sellTotal * (taxRatePct / 100);

    const pnl = sellTotal - buyTotal - feeTotal - taxTotal;
    const roi = buyTotal > 0 ? (pnl / buyTotal) * 100 : 0;

    setHidden(buyTotalHidden, buyTotal);
    setHidden(sellTotalHidden, sellTotal);
    setHidden(feeTotalHidden, feeTotal);
    setHidden(taxTotalHidden, taxTotal);
    setHidden(pnlHidden, pnl);
    setHidden(roiHidden, roi);

    setText(buyTotalTextEl, formatMoney(buyTotal));
    setText(sellTotalTextEl, formatMoney(sellTotal));
    setText(feeTotalTextEl, formatMoney(feeTotal));
    setText(taxTotalTextEl, formatMoney(taxTotal));

    setText(feeRateTextEl, `(${feeRatePct}%)`);
    setText(taxRateTextEl, `(${taxRatePct}%)`);

    setText(pnlTextEl, formatMoney(pnl));
    setText(roiBadgeEl, formatPercent(roi));

    if (pnlTextEl) {
    pnlTextEl.classList.remove("pnl-plus", "pnl-minus", "pnl-neutral");

    const isNeutral = !Number.isFinite(pnl) || Math.abs(pnl) < 1e-9;

    if (isNeutral) pnlTextEl.classList.add("pnl-neutral");
    else pnlTextEl.classList.add(pnl > 0 ? "pnl-plus" : "pnl-minus");
    }

    if (roiBadgeEl) {
      roiBadgeEl.classList.remove("roi-plus", "roi-minus", "roi-neutral");
      const isNeutral = !Number.isFinite(roi) || Math.abs(roi) < 1e-9;
      if (isNeutral) roiBadgeEl.classList.add("roi-neutral");
      else roiBadgeEl.classList.add(roi > 0 ? "roi-plus" : "roi-minus");
    }

    return { buyPrice, sellQty, sellPrice, feeRatePct, taxRatePct, buyTotal, sellTotal, feeTotal, taxTotal, pnl, roi };
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, MAX_HISTORY) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(arr) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, MAX_HISTORY)));
    } catch {}
  }

  function renderHistory() {
    if (!tbody) return;
    const items = loadHistory();
    tbody.innerHTML = "";

    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "avgTr";

      const c1 = document.createElement("div");
      c1.textContent = String(idx + 1);

      const c2 = document.createElement("div");
      c2.textContent = formatInt(it.buyPrice || 0);

      const c3 = document.createElement("div");
      c3.textContent = formatQty(it.sellQty || 0);

      const c4 = document.createElement("div");
      c4.textContent = formatInt(it.sellPrice || 0);

      const c5 = document.createElement("div");
      const roi = Number(it.roi) || 0;
      c5.textContent = formatPercent(roi);

      if (!Number.isFinite(roi) || Math.abs(roi) < 1e-9) c5.className = "roiTextNeutral";
      else c5.className = roi > 0 ? "roiTextPlus" : "roiTextMinus";

      row.append(c1, c2, c3, c4, c5);
      tbody.appendChild(row);
    });
  }

  function normalizeNumberInput(el) {
    if (!el) return;
    if (!el.value.trim()) return;
    el.value = String(toNumber(el.value));
  }

  function bindAutoCalc() {
    if (feeEl) {
      feeEl.addEventListener("input", compute);
      feeEl.addEventListener("blur", () => {
        normalizeNumberInput(feeEl);
        compute();
      });
    }

    if (taxEl) {
      taxEl.addEventListener("input", compute);
      taxEl.addEventListener("blur", () => {
        normalizeNumberInput(taxEl);
        compute();
      });
    }

    [buyPriceEl, sellQtyEl, sellPriceEl].filter(Boolean).forEach((el) => {
      el.addEventListener("input", () => {
        applyCommaWhileTyping(el);
        compute();
      });
      el.addEventListener("blur", () => {
        el.value = formatCommaIntString(el.value);
        compute();
      });
    });
  }

  function bindMiniButtons() {
    [
      { row: root.querySelector(".pfBuy"), input: buyPriceEl },
      { row: root.querySelector(".pfQty"), input: sellQtyEl },
      { row: root.querySelector(".pfSell"), input: sellPriceEl },
    ].forEach(({ row, input }) => {
      if (!row || !input) return;
      const btn = row.querySelector(".pfMiniBtn");
      if (!btn) return;
      btn.addEventListener("click", () => {
        input.value = "";
        input.focus();
        compute();
      });
    });
  }

  function bindActions() {
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        if (buyPriceEl) buyPriceEl.value = "";
        if (sellQtyEl) sellQtyEl.value = "";
        if (sellPriceEl) sellPriceEl.value = "";
        compute();
      });
    }

    if (btnClearHistory) {
      btnClearHistory.addEventListener("click", () => {
        try {
          localStorage.removeItem(LS_KEY);
        } catch {}
        renderHistory();
      });
    }

    if (btnSave) {
      btnSave.addEventListener("click", () => {
        const r = compute();
        if (!(r.buyPrice > 0) || !(r.sellQty > 0) || !(r.sellPrice > 0)) return;

        const items = loadHistory();
        items.unshift({
          t: Date.now(),
          buyPrice: r.buyPrice,
          sellQty: r.sellQty,
          sellPrice: r.sellPrice,
          feeRatePct: r.feeRatePct,
          taxRatePct: r.taxRatePct,
          pnl: r.pnl,
          roi: r.roi,
        });

        saveHistory(items);
        renderHistory();
      });
    }
  }

  function initDefaults() {
    if (feeEl && !feeEl.value.trim()) feeEl.value = "0.015";
    if (taxEl && !taxEl.value.trim()) taxEl.value = "0.2";
  }

  initDefaults();
  bindAutoCalc();
  bindMiniButtons();
  bindActions();
  compute();
  renderHistory();
})();
