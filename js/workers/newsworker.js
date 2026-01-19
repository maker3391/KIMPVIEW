export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/coinness/breaking") {
      return handleCoinnessBreaking(request, env, ctx);
    }

    return handleNaverNews(request, env, ctx);
  },
};

async function handleCoinnessBreaking(request, env, ctx) {
  const API_KEY = env.COINNESS_API_KEY;
  if (!API_KEY) {
    return json({ error: "Missing COINNESS_API_KEY env" }, 500, { "Cache-Control": "no-store" });
  }

  const url = new URL(request.url);

  const rawLimit = Number(url.searchParams.get("limit") || 40);
  const limit = Math.max(1, Math.min(40, Number.isFinite(rawLimit) ? rawLimit : 40));

  const since = (url.searchParams.get("since") || "").trim();
  const clientUpdatedAt = (url.searchParams.get("updatedAt") || "").trim();

  const BUCKET_MS = 10_000;
  const bucket = Math.floor(Date.now() / BUCKET_MS);

  const cache = caches.default;
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?limit=${limit}&b=${bucket}`,
    { method: "GET" }
  );

  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  try {
    const latestCursor = clampCoinnessUpdatedAt(
      clientUpdatedAt || new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    );
  
    let itemsA = await fetchCoinnessByUpdatedAt(API_KEY, limit, latestCursor);
    itemsA = itemsA.filter((x) => x && x.isDisplay !== false);

    const itemsB = [];
  
    const key = (x) =>
      `${x?.source || x?.link || ""}__${x?.publishAt || x?.updatedAt || ""}__${x?.title || ""}`;
  
    const seen = new Set();
    let items = [];
    for (const it of [...itemsA, ...itemsB]) { 
      const k = key(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }

    items.sort((a, b) => {
      const ta = new Date(a.publishAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.publishAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });

    if (since) {
      const sinceMs = Date.parse(since);
      if (Number.isFinite(sinceMs)) {
        items = items.filter((x) => {
          const t = new Date(x.publishAt || x.updatedAt || 0).getTime();
          return t > sinceMs;
        });
      }
    }

    items = items.slice(0, limit);

    const resp = json(items, 200, { "Cache-Control": "no-store" });
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return withCors(resp);
  } catch (e) {
    return json(
      { error: "COINNESS_WORKER_ERROR", detail: String(e?.message || e) },
      500,
      { "Cache-Control": "no-store" }
    );
  }
}


function clampCoinnessUpdatedAt(iso) {
  const now = Date.now();
  let t = Date.parse(iso);

  if (!Number.isFinite(t)) t = now - 6 * 60 * 60 * 1000;
  if (t > now) t = now;

  const maxPast = 14 * 24 * 60 * 60 * 1000;
  const minAllowed = now - maxPast;

  if (t < minAllowed) t = now - (13 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000);

  return new Date(t).toISOString();
}

async function fetchCoinnessByUpdatedAt(apiKey, limit, updatedAt) {
  const upstreamUrl =
    `https://api.coinness.com/feed/v1/partners/ko/news` +
    `?apikey=${encodeURIComponent(apiKey)}` +
    `&limit=${encodeURIComponent(limit)}` +
    `&updatedAt=${encodeURIComponent(updatedAt)}`;

  const res = await fetch(upstreamUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
    redirect: "follow",
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`COINNESS_HTTP_${res.status}: ${t.slice(0, 400)}`);
  }

  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function handleNaverNews(request, env, ctx) {
  const CLIENT_ID = env.NAVER_CLIENT_ID;
  const CLIENT_SECRET = env.NAVER_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ error: "Missing NAVER env" }, 500, { "Cache-Control": "no-store" });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "비트코인").trim();

  const display = Number(url.searchParams.get("display") || 50);
  const safeDisplay = Math.max(1, Math.min(100, Number.isFinite(display) ? display : 50));

  const metaLimitParam = Number(url.searchParams.get("metaLimit") || 35);
  const META_LIMIT = Math.max(0, Math.min(45, Number.isFinite(metaLimitParam) ? metaLimitParam : 35));

  const cacheKey = new Request(
    `${url.origin}${url.pathname}?q=${encodeURIComponent(query)}&display=${safeDisplay}&metaLimit=${META_LIMIT}`,
    { method: "GET" }
  );

  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  const naverUrl =
    `https://openapi.naver.com/v1/search/news.json` +
    `?query=${encodeURIComponent(query)}` +
    `&display=${safeDisplay}` +
    `&sort=date`;

  try {
    const naverRes = await fetch(naverUrl, {
      headers: {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
      },
      cf: { cacheTtl: 120, cacheEverything: true },
    });

    if (!naverRes.ok) {
      const t = await naverRes.text().catch(() => "");
      return json(
        { error: `NAVER_HTTP_${naverRes.status}`, detail: t.slice(0, 300) },
        502,
        { "Cache-Control": "no-store" }
      );
    }

    const data = await naverRes.json();
    const items = Array.isArray(data.items) ? data.items : [];

    const pickMeta = (html, prop, name) => {
      if (prop) {
        const re = new RegExp(
          `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`,
          "i"
        );
        const m = html.match(re);
        if (m && m[1]) return m[1].trim();
      }
      if (name) {
        const re = new RegExp(
          `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
          "i"
        );
        const m = html.match(re);
        if (m && m[1]) return m[1].trim();
      }
      return null;
    };

    const normalizeUrl = (base, u) => {
      try {
        if (!u) return null;
        if (u.startsWith("//")) return "https:" + u;
        return new URL(u, base).toString();
      } catch {
        return null;
      }
    };

    const fetchHtmlWithTimeout = async (pageUrl, ms) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort("TIMEOUT"), ms);
      try {
        const res = await fetch(pageUrl, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
          redirect: "follow",
          signal: ctrl.signal,
          cf: { cacheTtl: 600, cacheEverything: true },
        });
        return await res.text();
      } finally {
        clearTimeout(t);
      }
    };

    const META_TTL_SEC = 60 * 60 * 6;
    const TIMEOUT_MS = 1500;

    function hashKey(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
      return (h >>> 0).toString(16);
    }

    function metaCacheKey(link) {
      return `${url.origin}/__meta__/${hashKey(link)}`;
    }

    async function loadMetaForLink(link) {
      if (!link) return { extractedImage: null, extractedDesc: null };

      const mk = metaCacheKey(link);

      const cachedMeta = await cache.match(mk);
      if (cachedMeta) {
        const metaJson = await cachedMeta.json().catch(() => null);
        if (metaJson && (metaJson.extractedImage || metaJson.extractedDesc)) {
          return metaJson;
        }
      }

      try {
        const html = await fetchHtmlWithTimeout(link, TIMEOUT_MS);

        const extractedImageRaw =
          pickMeta(html, "og:image", null) || pickMeta(html, "twitter:image", null);

        const extractedDesc =
          pickMeta(html, "og:description", null) ||
          pickMeta(html, "twitter:description", null) ||
          pickMeta(html, null, "description");

        const meta = {
          extractedImage: normalizeUrl(link, extractedImageRaw) || null,
          extractedDesc: extractedDesc ? extractedDesc.trim() : null,
        };

        const metaResp = json(meta, 200, {
          "Cache-Control": `public, max-age=${META_TTL_SEC}`,
        });
        ctx.waitUntil(cache.put(mk, metaResp.clone()));

        return meta;
      } catch {
        return { extractedImage: null, extractedDesc: null };
      }
    }

    const CONCURRENCY = 3;

    async function mapLimit(arr, limit, fn) {
      const out = new Array(arr.length);
      let i = 0;

      async function worker() {
        while (i < arr.length) {
          const idx = i++;
          try {
            out[idx] = await fn(arr[idx], idx);
          } catch {
            out[idx] = arr[idx];
          }
        }
      }

      const workers = Array.from({ length: Math.min(limit, arr.length) }, () => worker());
      await Promise.all(workers);
      return out;
    }

    const itemsWithMeta = await mapLimit(items, CONCURRENCY, async (item, idx) => {
      if (idx >= META_LIMIT) return item;

      const link = item?.originallink || item?.link;
      const meta = await loadMetaForLink(link);

      return { ...item, ...meta };
    });

    const resp = json(itemsWithMeta, 200, { "Cache-Control": "public, max-age=120" });

    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return withCors(resp);
  } catch (e) {
    return json(
      { error: "WORKER_ERROR", detail: String(e?.message || e) },
      500,
      { "Cache-Control": "no-store" }
    );
  }
}

function withCors(response) {
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", "*");
  if (!h.get("Content-Type")) h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(response.body, { status: response.status, headers: h });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}
