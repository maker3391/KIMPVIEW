(() => {
  "use strict";

  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const $ = (sel) => document.querySelector(sel);

  const buttons = $$(".calculator-menu .calc-btn[data-target]");
  if (buttons.length === 0) return;

  const sections = $$("#fxCalc, #avgCostCalc, #profitCalc, #compoundCalc, #lossRecoveryCalc");

  const sectionById = new Map(sections.map(s => [s.id, s]));

  function hideAll() {
    sections.forEach(s => s.classList.add("fxHidden"));
  }

  function setActiveButton(targetId) {
    buttons.forEach(b => b.classList.remove("active"));
    const active = buttons.find(b => b.dataset.target === targetId);
    if (active) active.classList.add("active");
  }

  function showSection(targetId, { updateHash = true, scroll = true } = {}) {
    const section = sectionById.get(targetId);
    if (!section) return;

    hideAll();
    section.classList.remove("fxHidden");
    setActiveButton(targetId);

    if (updateHash) {
      history.replaceState(null, "", `#${targetId}`);
    }

    if (scroll) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      showSection(targetId, { updateHash: true, scroll: false }); 
    });
  });

  function initFromHash() {
    const hashId = (location.hash || "").replace("#", "");
    if (hashId && sectionById.has(hashId)) {
      showSection(hashId, { updateHash: false, scroll: false });
      return;
    }

    hideAll();
    const firstSection = sectionById.get("fxCalc");
    if(firstSection) {
        firstSection.classList.remove("fxHidden");
        setActiveButton("fxCalc");
    }
  }

  window.addEventListener("hashchange", initFromHash);

  initFromHash();
})();
