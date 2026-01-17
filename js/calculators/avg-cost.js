(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const curPrice = $("#cur_price");
  const curQty = $("#cur_qty");
  const curCost = $("#cur_cost");

  const addPrice = $("#add_price");
  const addQty = $("#add_qty");
  const addCost = $("#add_cost");

  const finPrice = $("#fin_price");
  const finQty = $("#fin_qty");
  const finCost = $("#fin_cost");

  const tbody = $("#avg_tbody");

  const btnStack = $("#avg_copyCurrent");
  const btnResetHist = $("#avg_resetHistory");

  const decimalsRadios = document.querySelectorAll('input[name="avgDecimals"]');

  if (
    !curPrice || !curQty || !curCost ||
    !addPrice || !addQty || !addCost ||
    !finPrice || !finQty || !finCost ||
    !btnStack || !btnResetHist
  ) return;

  let decimalsMode = "basic"; 

  const STORAGE_KEY = "KIMPVIEW_AVG_HISTORY_V1";
  const history = loadHistory();

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(r => r && Number.isFinite(r.price) && Number.isFinite(r.qty) && Number.isFinite(r.cost))
        .map(r => ({ price: r.price, qty: r.qty, cost: r.cost }));
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {}
  }

  function clearAllInputs() {
    curPrice.value = "";
    curQty.value = "";
    curCost.value = "";

    addPrice.value = "";
    addQty.value = "";
    addCost.value = "";

    finPrice.value = "";
    finQty.value = "";
    finCost.value = "";
  }

  function parseNum(v) {
    const s = String(v || "").replace(/,/g, "").trim();
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function cleanInput(el) {
    const cleaned = el.value.replace(/[^\d.,-]/g, "");
    if (cleaned !== el.value) el.value = cleaned;
  }

  function formatOnBlur(el) {
    const n = parseNum(el.value);
    if (!Number.isFinite(n)) {
      el.value = "";
      return;
    }
    el.value = n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
  }

  function fmt(n) {
    if (!Number.isFinite(n)) return "";
    if (decimalsMode === "basic") {
      return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
    }
    return n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
  }

  function fmtQty(n) {
    if (!Number.isFinite(n)) return "";
    if (decimalsMode === "basic") {
      return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
    }
    return n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
  }

  function fmtMoney(n) {
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  }

  function syncAdd(changed) {
    const p = parseNum(addPrice.value);
    const q = parseNum(addQty.value);
    const c = parseNum(addCost.value);

    const hasP = Number.isFinite(p) && p > 0;
    const hasQ = Number.isFinite(q) && q > 0;
    const hasC = Number.isFinite(c) && c > 0;

    if (hasP && hasQ && changed !== "cost") {
      addCost.value = fmtMoney(p * q);
      return;
    }
    if (hasP && hasC && changed !== "qty") {
      addQty.value = fmtQty(c / p);
      return;
    }
    if (hasQ && hasC && changed !== "price") {
      addPrice.value = fmt(c / q);
      return;
    }
  }

  function calcCurrentBase() {
    const p = parseNum(curPrice.value);
    const q = parseNum(curQty.value);

    if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) {
      curCost.value = "";
      return null;
    }

    const cost = p * q;
    curCost.value = fmtMoney(cost);
    return { price: p, qty: q, cost };
  }

  function getAddDraft() {
    const p = parseNum(addPrice.value);
    const q = parseNum(addQty.value);
    const c = parseNum(addCost.value);

    const hasP = Number.isFinite(p) && p > 0;
    const hasQ = Number.isFinite(q) && q > 0;
    const hasC = Number.isFinite(c) && c > 0;

    if (!hasP) return null;

    if (hasQ) {
      const cost = hasC ? c : (p * q);
      return { price: p, qty: q, cost };
    }
    if (hasC) {
      return { price: p, qty: c / p, cost: c };
    }
    return null;
  }

  function computeFinal(base, draft) {
    let totalQty = base.qty;
    let totalCost = base.cost;

    for (const r of history) {
      totalQty += r.qty;
      totalCost += r.cost;
    }

    if (draft) {
      totalQty += draft.qty;
      totalCost += draft.cost;
    }

    if (!Number.isFinite(totalQty) || totalQty <= 0) return null;

    return {
      qty: totalQty,
      cost: totalCost,
      price: totalCost / totalQty
    };
  }

  function renderHistory() {
    if (!tbody) return;
    tbody.innerHTML = history.map((r, idx) => `
      <div class="avgTr">
        <div>${idx + 1}</div>
        <div>${fmt(r.price)}</div>
        <div>${fmtQty(r.qty)}</div>
        <div>₩${fmtMoney(r.cost)}</div>
      </div>
    `).join("");
  }

  function recalc() {
    const base = calcCurrentBase();

    if (!base) {
      finPrice.value = "";
      finQty.value = "";
      finCost.value = "";
      renderHistory();
      return;
    }

    const draft = getAddDraft();
    const fin = computeFinal(base, draft);

    if (!fin) {
      finPrice.value = "";
      finQty.value = "";
      finCost.value = "";
      renderHistory();
      return;
    }

    finPrice.value = fmt(fin.price);
    finQty.value = fmtQty(fin.qty);
    finCost.value = fmtMoney(fin.cost);

    renderHistory();
  }

  function stackFinalToHistory() {
    const base = calcCurrentBase();
    if (!base) return;

    const draft = getAddDraft();
    const fin = computeFinal(base, draft);
    if (!fin) return;

    history.push({ price: fin.price, qty: fin.qty, cost: fin.cost });
    saveHistory(); 

    addPrice.value = "";
    addQty.value = "";
    addCost.value = "";

    recalc();
  }

  function resetHistory() {
    history.length = 0;
    saveHistory(); 
    recalc();
  }

  [curPrice, curQty].forEach((el) => {
    el.addEventListener("input", () => { cleanInput(el); recalc(); });
    el.addEventListener("blur", () => { formatOnBlur(el); recalc(); });
  });

  addPrice.addEventListener("input", () => { cleanInput(addPrice); syncAdd("price"); recalc(); });
  addQty.addEventListener("input", () => { cleanInput(addQty); syncAdd("qty"); recalc(); });
  addCost.addEventListener("input", () => { cleanInput(addCost); syncAdd("cost"); recalc(); });

  [addPrice, addQty, addCost].forEach((el) => {
    el.addEventListener("blur", () => { formatOnBlur(el); });
  });

  btnStack.addEventListener("click", stackFinalToHistory);
  btnResetHist.addEventListener("click", resetHistory);

  decimalsRadios.forEach((r) => {
    r.addEventListener("change", () => {
      decimalsMode = (r.value === "0") ? "basic" : "full";
      recalc();
    });
  });

  clearAllInputs();
  recalc();
})();
