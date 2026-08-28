/**
 * Live roster lookup, backed by API-Football.
 *
 * The game asks you to compare market values, and API-Football does not
 * publish those — valuations are Transfermarkt's data, not theirs. So the
 * numbers stay curated in src/data/squad.js and this function supplies the
 * things the API is authoritative about and that go stale fastest:
 *
 *   photo   a licensed portrait, so we stop leaning on Wikipedia's CC BY-SA
 *   age     correct on the day rather than whenever the array was written
 *   club    a player who moved shows up under the club he actually plays for
 *
 * A player is only ever included if his name matches a curated entry, so
 * every card the game deals still has a value behind it.
 *
 * GET /api/squad  ->  { source, players: [...], stats: {...} }
 *
 * Failure is never fatal: no key, a dead network, or a rate-limit wall all
 * return source:"static" and an empty roster, and the browser keeps playing
 * off the built-in array.
 */
import {
  SQUAD,
  CLUBS,
  CLUB_QUERY,
  POSITION,
  matchPlayer,
} from "../src/data/squad.js";

const HOST = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY;

/* One squad refresh costs ~2 calls per club, and the free tier allows 100
 * a day. Holding the answer at the edge for a day keeps a busy game to a
 * single refresh; the stale window means nobody ever waits on one. */
const CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";
const CACHE_FAIL = "public, s-maxage=300";

/* Warm invocations reuse resolved team IDs, which halves the call count on
 * every refresh after the first. */
const teamIds = new Map();

/* RapidAPI fronts the same API behind different auth headers. */
function authHeaders() {
  if (HOST.includes("rapidapi")) {
    return { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST };
  }
  return { "x-apisports-key": KEY };
}

async function call(path, timeoutMs = 8000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${HOST}/${path}`, {
      headers: { ...authHeaders(), Accept: "application/json" },
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    // API-Football answers 200 with a populated `errors` field for auth and
    // quota problems, so a bare res.ok is not enough to call it a success.
    if (body && body.errors && Object.keys(body.errors).length) return null;
    return Array.isArray(body?.response) ? body.response : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Our display names are short ("Man City", "Atlético"); the API's are not.
 * Search under the mapped name and take the closest hit rather than the
 * first, so "Inter" doesn't resolve to some third-tier namesake. */
async function resolveTeam(club) {
  if (teamIds.has(club)) return teamIds.get(club);

  const query = CLUB_QUERY[club] || club;
  const hits = await call(`teams?search=${encodeURIComponent(query)}`);
  // A miss here is usually a blip — a timeout, a spent quota — so it is not
  // remembered. Caching the null would strand this club for the life of the
  // warm instance, long after the API came back.
  if (!hits || !hits.length) return null;

  const want = query.toLowerCase();
  const exact = hits.find((h) => (h.team?.name || "").toLowerCase() === want);
  const id = (exact || hits[0]).team?.id ?? null;

  if (id) teamIds.set(club, id);
  return id;
}

async function fetchClub(club) {
  const id = await resolveTeam(club);
  if (!id) return [];

  const squads = await call(`players/squads?team=${id}`);
  const roster = squads?.[0]?.players;
  if (!Array.isArray(roster)) return [];

  const out = [];
  for (const person of roster) {
    const curated = matchPlayer(person.name);
    if (!curated) continue; // no valuation, so nothing to guess against

    out.push({
      ...curated,
      club, // the club we searched, so the KIT gradient always resolves
      age: Number.isFinite(person.age) ? person.age : curated.age,
      pos: curated.pos || POSITION[person.position] || "",
      photo: person.photo || null,
    });
  }
  return out;
}

/* Resolve a few clubs at a time. All 23 at once trips the per-minute
 * rate limit on the smaller plans; one at a time takes too long for a
 * cold request to sit through. */
async function mapLimit(items, limit, fn) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  if (!KEY) {
    res.setHeader("Cache-Control", CACHE_FAIL);
    res.status(200).json({
      source: "static",
      reason: "API_FOOTBALL_KEY is not set",
      players: [],
    });
    return;
  }

  try {
    const perClub = await mapLimit(CLUBS, 4, fetchClub);
    const players = perClub.flat();

    // One player per curated entry. A loanee can appear in two squads, and
    // dealing the same man twice in a round would read as a bug.
    const seen = new Set();
    const unique = players.filter((p) => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });

    /* A thin result means the API answered but the join mostly missed —
     * a renamed club, an expired plan, a quota wall part-way through. The
     * built-in array is better than a half-empty deck, so say so and let
     * the browser keep it. */
    if (unique.length < SQUAD.length / 2) {
      res.setHeader("Cache-Control", CACHE_FAIL);
      res.status(200).json({
        source: "static",
        reason: `only ${unique.length} of ${SQUAD.length} players resolved`,
        players: [],
      });
      return;
    }

    res.setHeader("Cache-Control", CACHE);
    res.status(200).json({
      source: "api-football",
      players: unique,
      stats: {
        clubs: CLUBS.length,
        clubsResolved: perClub.filter((c) => c.length).length,
        matched: unique.length,
        curated: SQUAD.length,
      },
    });
  } catch (e) {
    res.setHeader("Cache-Control", CACHE_FAIL);
    res.status(200).json({ source: "static", reason: "lookup failed", players: [] });
  }
}
