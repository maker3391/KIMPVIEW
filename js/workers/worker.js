export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonRes = (obj, { status = 200, cacheSec = 0, extraHeaders = {} } = {}) => {
      const headers = {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": cacheSec > 0 ? `public, max-age=${cacheSec}` : "no-store",
        ...extraHeaders,
      };
      return new Response(JSON.stringify(obj), { status, headers });
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function withCors(response, cacheSec = 0, contentType = null) {
      const h = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v);

      if (contentType) h.set("Content-Type", contentType);

      h.set("Cache-Control", cacheSec > 0 ? `public, max-age=${cacheSec}` : "no-store");
      return new Response(response.body, { status: response.status, headers: h });
    }

    async function fetchWithTimeout(url, { timeoutMs = 8000, headers = {}, cf = undefined } = {}) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort("TIMEOUT"), timeoutMs);
      try {
        return await fetch(url, { signal: ctrl.signal, headers, cf });
      } finally {
        clearTimeout(t);
      }
    }

    async function fetchWithRetry(
      url,
      { timeoutMs = 8000, headers = {}, cf = undefined, retries = 2, retryBaseMs = 200 } = {}
    ) {
      let lastErr;
      for (let i = 0; i <= retries; i++) {
        try {
          const res = await fetchWithTimeout(url, { timeoutMs, headers, cf });
          if ((res.status === 429 || (res.status >= 500 && res.status <= 599)) && i < retries) {
            await sleep(retryBaseMs * (i + 1));
            continue;
          }
          return res;
        } catch (e) {
          lastErr = e;
          if (i < retries) {
            await sleep(retryBaseMs * (i + 1));
            continue;
          }
        }
      }
      throw lastErr || new Error("fetch failed");
    }

    const FINNHUB_KEY = env.FINNHUB_KEY;

    const fetchYahooData = async (symbol, isStock = false) => {
      let sym = String(symbol || "").trim();
      if (!isStock && /^[A-Z]{6}$/.test(sym) && !sym.endsWith("=X")) {
        sym = `${sym}=X`;
      }

      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        sym
      )}?interval=1d&range=7d`;

      const yRes = await fetchWithRetry(yahooUrl, {
        timeoutMs: 9000,
        retries: 2,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        cf: { cacheTtl: 30, cacheEverything: true },
      });

      if (!yRes.ok) throw new Error(`Yahoo API Error: ${yRes.status}`);

      const yJson = await yRes.json();
      const r = yJson?.chart?.result?.[0] || {};
      const meta = r.meta || {};
      const indicators = r.indicators?.quote?.[0] || {};
      const closes = (indicators.close || []).filter((v) => v !== null && v !== undefined);

      let latest = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
      let prev = meta.previousClose ?? closes[closes.length - 2] ?? null;

      if (latest !== null && prev !== null && latest === prev && closes.length >= 2) {
        prev = closes[closes.length - 2];
      }

      const pctChange = latest != null && prev != null && prev !== 0 ? ((latest - prev) / prev) * 100 : null;

      let mcap = meta.marketCap || 0;

      if (isStock && mcap === 0) {
        try {
          const pureSym = sym.split(".")[0].toUpperCase();
          const fRes = await fetchWithRetry(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${pureSym}&token=${FINNHUB_KEY}`,
            { timeoutMs: 4000, retries: 1, cf: { cacheTtl: 300, cacheEverything: true } }
          );
          if (fRes.ok) {
            const fData = await fRes.json();
            if (fData.marketCapitalization) {
              mcap = fData.marketCapitalization * 1000000;
            }
          }
        } catch (e) {}
      }

      const volume = meta.regularMarketVolume || 0;
      const volumeDollar = latest ? latest * volume : 0;

      const payload = {
        symbol: meta.symbol || sym,
        name: meta.shortName || meta.longName || sym,
        price: latest,
        latest: latest,
        prevClose: prev,
        prev: prev,
        pctChange,
        mcap,
        volumeDollar,
        dayHigh: meta.regularMarketDayHigh || null,
        dayLow: meta.regularMarketDayLow || null,
        currency: meta.currency || "USD",
        ts: (meta.regularMarketTime || Date.now() / 1000) * 1000,
        closes: closes.slice(-20),
        source: "Yahoo Finance",
      };

      if (sym === "^TNX") {
        if (payload.latest) payload.latest /= 10;
        if (payload.prev) payload.prev /= 10;
        if (payload.price) payload.price /= 10;
        if (payload.prevClose) payload.prevClose /= 10;
        payload.unit = "%";
      }

      return payload;
    };

    async function fetchYahooQuoteBatch(symbols) {
      const uniq = Array.from(
        new Set(
          (symbols || [])
            .map((s) => String(s || "").trim())
            .filter(Boolean)
        )
      );
      if (!uniq.length) return [];

      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        uniq.join(",")
      )}`;

      const res = await fetchWithRetry(url, {
        timeoutMs: 6000,
        retries: 1,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
        cf: { cacheTtl: 20, cacheEverything: true },
      });

      if (!res.ok) throw new Error(`Yahoo Quote Error: ${res.status}`);

      const j = await res.json();
      const arr = j?.quoteResponse?.result || [];
      return Array.isArray(arr) ? arr : [];
    }

    function normalizeQuoteToPayload(q, fallbackSymbol) {
      const sym = String(q?.symbol || fallbackSymbol || "").trim() || String(fallbackSymbol || "").trim();

      const price = Number(q?.regularMarketPrice);
      const prev = Number(q?.regularMarketPreviousClose);
      const pctFromApi = Number(q?.regularMarketChangePercent);

      const pctChange =
        Number.isFinite(pctFromApi)
          ? pctFromApi
          : Number.isFinite(price) && Number.isFinite(prev) && prev !== 0
            ? ((price - prev) / prev) * 100
            : null;

      const mcap = Number(q?.marketCap) || 0;
      const volume = Number(q?.regularMarketVolume) || 0;
      const volumeDollar = Number.isFinite(price) ? price * volume : 0;

      const tsSec = Number(q?.regularMarketTime);
      const ts = Number.isFinite(tsSec) ? tsSec * 1000 : Date.now();

      return {
        symbol: sym,
        name: q?.shortName || q?.longName || sym,
        price: Number.isFinite(price) ? price : null,
        latest: Number.isFinite(price) ? price : null,
        prevClose: Number.isFinite(prev) ? prev : null,
        prev: Number.isFinite(prev) ? prev : null,
        pctChange: pctChange != null ? pctChange : null,
        mcap,
        volumeDollar,
        dayHigh: q?.regularMarketDayHigh ?? null,
        dayLow: q?.regularMarketDayLow ?? null,
        currency: q?.currency || "USD",
        ts,
        closes: [],
        source: "Yahoo Quote (Batch)",
      };
    }

    const PATH_TO_SYMBOL = {
      "/dxy": "DX-Y.NYB",
      "/us10y": "^TNX",
      "/gold": "GC=F",
      "/oil": "CL=F",
      "/vix": "^VIX",
    };

    try {
      const url = new URL(request.url);
      const path = url.pathname;

    if (path === "/coinpaprika-caps") {
      const cacheSec = 60 * 60 * 12; 
      const cacheKey = new Request(url.origin + "/__paprika_caps_v3");
      const cache = caches.default;

      const cached = await cache.match(cacheKey);
      if (cached) {
        const out = withCors(cached, cacheSec, "application/json; charset=utf-8");
        out.headers.set("X-Cache", "HIT");
        return out;
      }

      const pUrl = "https://api.coinpaprika.com/v1/tickers?quotes=USD";

      let pRes;
      try {
        pRes = await fetchWithRetry(pUrl, {
          timeoutMs: 15000,
          retries: 3,
          retryBaseMs: 500, 
          cf: { cacheTtl: cacheSec, cacheEverything: true },
          headers: {
            "Accept": "application/json",
            "User-Agent": "kimpview-proxy/1.0"
          },
        });
      } catch (e) {
        const stale = await cache.match(cacheKey);
        if (stale) {
          const out = withCors(stale, cacheSec, "application/json; charset=utf-8");
          out.headers.set("X-Cache", "STALE_ON_THROW");
          return out;
        }
        return jsonRes(
          { error: "CoinPaprika fetch failed", detail: String(e) },
          { status: 502, cacheSec: 30, extraHeaders: { "X-Cache": "ERROR_THROW" } }
        );
      }

      if (!pRes.ok) {
        const stale = await cache.match(cacheKey);
        if (stale) {
          const out = withCors(stale, cacheSec, "application/json; charset=utf-8");
          out.headers.set("X-Cache", "STALE_ON_HTTP_" + pRes.status);
          return out;
        }
        return jsonRes(
          { error: "CoinPaprika HTTP error", status: pRes.status },
          { status: pRes.status, cacheSec: 30, extraHeaders: { "X-Cache": "ERROR_HTTP_" + pRes.status } }
        );
      }

      const arr = await pRes.json().catch(() => null);
      if (!Array.isArray(arr)) {
        const stale = await cache.match(cacheKey);
        if (stale) {
          const out = withCors(stale, cacheSec, "application/json; charset=utf-8");
          out.headers.set("X-Cache", "STALE_ON_PAYLOAD");
          return out;
        }
        return jsonRes({ error: "CoinPaprika unexpected payload" }, { status: 502, cacheSec: 30 });
      }

      const caps = {};
      for (const it of arr) {
        const id = String(it?.id || "");
        const sym = String(it?.symbol || "").toUpperCase();
        const mc = Number(it?.quotes?.USD?.market_cap || 0);
        if (!mc) continue;

        if (sym === "USDT") {
          if (id === "tether-usdt") caps.USDT = mc;
          else {
            const prev = Number(caps.USDT || 0);
            if (mc > prev) caps.USDT = mc;
          }
          continue;
        }

        const prev = Number(caps[sym] || 0);
        if (mc > prev) caps[sym] = mc;
      }

      const resp = jsonRes(caps, { cacheSec });
      resp.headers.set("X-Cache", "MISS_STORE");
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }

      if (path === "/fx/google") {
        const gRes = await fetchWithRetry("https://www.google.com/finance/quote/USD-KRW?hl=en", {
          timeoutMs: 9000,
          retries: 2,
          cf: { cacheTtl: 60, cacheEverything: true },
        });
        const html = await gRes.text();
        const m = html.match(/YMlKec\s+fxKbKc[^>]*>\s*([0-9,.]+)<\/div>/i);
        const rate = m ? parseFloat(m[1].replace(/,/g, "")) : null;
        return jsonRes({ pair: "USDKRW", rate, ts: Date.now(), source: "Google Finance" }, { cacheSec: 60 });
      }

      if (path === "/upbit") {
        const market = (url.searchParams.get("market") || "").trim();
        if (!market) return jsonRes({ error: "Missing market" }, { status: 400 });

        const upbitUrl = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`;
        const cacheSec = 3;

        const upRes = await fetchWithRetry(upbitUrl, {
          timeoutMs: 15000,
          retries: 3,
          cf: { cacheTtl: cacheSec, cacheEverything: true },
        });

        if (!upRes.ok) return jsonRes({ error: "Upbit fetch failed", status: upRes.status }, { status: 502 });

        const arr = await upRes.json();
        const t = arr?.[0];

        return jsonRes(
          {
            market: t?.market ?? market,
            trade_price: t?.trade_price ?? null,
            acc_trade_price_24h: t?.acc_trade_price_24h ?? null,
            timestamp: t?.timestamp ?? null,
          },
          { cacheSec }
        );
      }

      if (path.startsWith("/upbit/")) {
        const targetPath = path.replace("/upbit", "");
        const target = "https://api.upbit.com" + targetPath + url.search;

        const isMarketAll = targetPath.startsWith("/v1/market/all");
        const isTicker = targetPath.startsWith("/v1/ticker");
        const cacheTtl = isMarketAll ? 21600 : isTicker ? 3 : 10;

        const upRes = await fetchWithRetry(target, {
          timeoutMs: isMarketAll ? 30000 : 10000,
          retries: 2,
          cf: { cacheTtl, cacheEverything: true },
          headers: { Accept: "application/json" },
        });

        const headers = new Headers(upRes.headers);
        for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
        headers.set("Cache-Control", `public, max-age=${cacheTtl}`);

        return new Response(upRes.body, { status: upRes.status, headers });
      }

      if (path.startsWith("/bithumb/")) {
        const targetPath = path.replace("/bithumb", "");
        const target = "https://api.bithumb.com" + targetPath + url.search;

        const isMarketAll = targetPath.startsWith("/v1/market/all");
        const isAllTicker = targetPath.startsWith("/public/ticker/ALL_KRW");
        const cacheSec = isMarketAll ? 21600 : isAllTicker ? 3 : 5;

        const biRes = await fetchWithRetry(target, {
          timeoutMs: 8000,
          retries: 2,
          cf: { cacheTtl: cacheSec, cacheEverything: true },
          headers: { Accept: "application/json" },
        });

        return withCors(biRes, cacheSec, "application/json; charset=utf-8");
      }

      if (PATH_TO_SYMBOL[path]) {
        const data = await fetchYahooData(PATH_TO_SYMBOL[path]);
        return jsonRes(data, { cacheSec: 60 });
      }

      if (path === "/stock-icon") {
        const symRaw = (url.searchParams.get("symbol") || "").trim();
        if (!symRaw) return jsonRes({ error: "Missing symbol" }, { status: 400 });

        const symbol = symRaw.toUpperCase();

        const iconUrl = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`;

        const cacheSec = 60 * 60 * 24 * 7; 
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/__stock_icon__/${encodeURIComponent(symbol)}`);

        const cached = await cache.match(cacheKey);
        if (cached) return withCors(cached, cacheSec); 

        const res = await fetchWithRetry(iconUrl, {
          timeoutMs: 7000,
          retries: 1,
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
          cf: { cacheTtl: cacheSec, cacheEverything: true },
        });

        if (!res.ok) {
          return withCors(new Response("Not Found", { status: 404 }), 60, "text/plain; charset=utf-8");
        }

        const out = withCors(res, cacheSec); 
        ctx.waitUntil(cache.put(cacheKey, out.clone()));
        return out;
      }

      if (path === "/stocks" || path === "/stock") {
        const raw = url.searchParams.get("symbols") || url.searchParams.get("symbol") || "";
        const syms = raw.split(",").map((s) => String(s || "").trim()).filter(Boolean);
        if (!syms.length) return jsonRes({ error: "Missing symbol" }, { status: 400 });

        if (path === "/stock" && syms.length === 1) {
          const data = await fetchYahooData(syms[0], true);
          return jsonRes(data, { cacheSec: 120 });
        }

        let quotes = [];
        try {
          quotes = await fetchYahooQuoteBatch(syms);
        } catch (e) {
          const itemsFallback = await Promise.all(
            syms.map(async (s) => {
              try {
                return await fetchYahooData(s, true);
              } catch {
                return { symbol: s, error: true };
              }
            })
          );
          return jsonRes({ items: itemsFallback }, { cacheSec: 60 });
        }

        const qMap = new Map();
        for (const q of quotes) {
          const s = String(q?.symbol || "").trim();
          if (s) qMap.set(s.toUpperCase(), q);
        }

        const items = syms.map((s) => {
          const key = String(s).trim().toUpperCase();
          const q = qMap.get(key) || qMap.get(key.replace(".", ""));
          if (!q) return { symbol: s, error: true };
          return normalizeQuoteToPayload(q, s);
        });

        return jsonRes({ items }, { cacheSec: 60 });
      }

      if (path === "/yahoo" || (path === "/" && url.searchParams.has("symbol"))) {
        const s = url.searchParams.get("symbol");
        const data = await fetchYahooData(s);
        return jsonRes(data, { cacheSec: 60 });
      }

      return jsonRes({
        ok: true,
        routes: [
          "/fx/google",
          "/upbit (legacy ?market=KRW-BTC)",
          "/upbit/* (proxy)",
          "/bithumb/* (proxy)",
          ...Object.keys(PATH_TO_SYMBOL),
          "/stock-icon?symbol=AAPL",
          "/stock?symbol=...",
          "/stocks?symbols=AAPL,MSFT",
          "/yahoo?symbol=...",
        ],
      });
    } catch (e) {
      return jsonRes({ error: String(e?.message || e) }, { status: 500 });
    }
  },
};
