(function () {
  function initTV() {
    const el = document.getElementById("tv_btcusdt");
    if (!el || !window.TradingView) return;

    new TradingView.widget({
      container_id: "tv_btcusdt",
      autosize: true,
      symbol: "BINANCE:BTCUSDT",
      interval: "60",              
      timezone: "Asia/Seoul",
      theme: "dark",
      style: "1",
      locale: "kr",
      toolbar_bg: "#0b0f14",
      enable_publishing: false,
      allow_symbol_change: false,
      withdateranges: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      save_image: false
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTV);
  } else {
    initTV();
  }
})();