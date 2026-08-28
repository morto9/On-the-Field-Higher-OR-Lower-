/**
 * Server-side photo lookup.
 *
 * The browser can't call Wikipedia directly — cross-origin rules are not ours
 * to control and they change. This runs on Vercel instead, so the game only
 * ever talks to its own origin. Responses are cached hard at the edge because
 * a player's portrait does not change.
 *
 * GET /api/photo?title=Kylian_Mbappé  ->  { "src": "https://..." | null }
 */
export default async function handler(req, res) {
  const title = (req.query.title || "").toString().slice(0, 120);

  if (!title) {
    res.status(400).json({ error: "Pass a Wikipedia article title as ?title=" });
    return;
  }

  try {
    const wiki = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        headers: {
          // Wikimedia asks for a contactable user agent on API traffic.
          "Api-User-Agent": "MoreOrLess/1.0 (https://github.com/) contact via repo issues",
          Accept: "application/json",
        },
      }
    );

    if (!wiki.ok) {
      res.setHeader("Cache-Control", "public, s-maxage=3600");
      res.status(200).json({ src: null });
      return;
    }

    const data = await wiki.json();
    const thumb = data && data.thumbnail && data.thumbnail.source;
    const src = thumb ? thumb.replace(/\/\d+px-/, "/640px-") : null;

    // A portrait is effectively immutable, so cache it for a week at the edge
    // and let stale copies serve for a month while a refresh happens behind it.
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    res.status(200).json({ src, credit: data.content_urls?.desktop?.page || null });
  } catch (e) {
    res.setHeader("Cache-Control", "public, s-maxage=300");
    res.status(200).json({ src: null });
  }
}
