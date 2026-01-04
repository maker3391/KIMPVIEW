export default {
  async fetch(request, env, ctx) {
    const CLIENT_ID = env.NAVER_CLIENT_ID;
    const CLIENT_SECRET = env.NAVER_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "Missing NAVER env" }, 500, { "Cache-Control": "no-store" });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "비트코인").trim();
    const display = Math.min(Number(url.searchParams.get("display") || 15), 30);

    const cacheKey = new Request(
      `${url.origin}${url.pathname}?q=${encodeURIComponent(query)}&display=${display}`,
      { method: "GET" }
    );

    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) return withCors(cached);

    const naverUrl =
      `https://openapi.naver.com/v1/search/news.json` +
      `?query=${encodeURIComponent(query)}` +
      `&display=${display}` +
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
            signal: ctrl.signal,

            cf: { cacheTtl: 600, cacheEverything: true },
          });
          return await res.text();
        } finally {
          clearTimeout(t);
        }
      };


      // =========================
      const META_TTL_SEC = 60 * 60 * 6; 
      const TIMEOUT_MS = 2500;

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

          // 3) meta 결과 캐시 저장 (다음부터 빨라짐)
          const metaResp = json(meta, 200, {
            "Cache-Control": `public, max-age=${META_TTL_SEC}`,
          });
          ctx.waitUntil(cache.put(mk, metaResp.clone()));

          return meta;
        } catch {
          return { extractedImage: null, extractedDesc: null };
        }
      }

      // =========================
      const CONCURRENCY = 5;

      async function mapLimit(arr, limit, fn) {
        const out = new Array(arr.length);
        let i = 0;

        async function worker() {
          while (i < arr.length) {
            const idx = i++;
            out[idx] = await fn(arr[idx], idx);
          }
        }

        const workers = Array.from({ length: Math.min(limit, arr.length) }, () => worker());
        await Promise.all(workers);
        return out;
      }

      const itemsWithMeta = await mapLimit(items, CONCURRENCY, async (item) => {
        const link = item?.link;
        const meta = await loadMetaForLink(link);
        return { ...item, ...meta };
      });

      const resp = json(itemsWithMeta, 200, {
        "Cache-Control": "public, max-age=120",
      });

      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;

    } catch (e) {
      return json({ error: String(e?.message || e) }, 500, { "Cache-Control": "no-store" });
    }
  },
};

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
