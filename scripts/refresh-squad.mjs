/**
 * Refresh club, age and portrait from API-Football into src/data/roster.js.
 *
 * A maintenance command, not part of the app. You run it, read the diff,
 * and commit the result. The deployed game reads roster.js as a plain
 * module: no API key in production, no per-request quota, no third-party
 * service that can be down while people are playing.
 *
 * API-Football's free tier is 100 requests a day and a full refresh costs
 * about two per club. Spending that on a scheduled command a few times a
 * season is very different from spending it on traffic.
 *
 * Portraits are resolved from API-Football first and Wikipedia second, so
 * the committed file ends up with a URL for as many players as possible
 * and the game needs no photo lookup at runtime at all. Those URLs point at
 * someone else's CDN; run scripts/fetch-photos.mjs afterwards to take local
 * copies. A copy already taken is preserved here unless its source moved.
 *
 *   npm run refresh-squad:teams   # resolve club -> team id, once, and commit
 *   npm run refresh-squad         # dry run, prints the diff
 *   npm run refresh-squad:write   # applies it
 *
 * Flags (usable directly, or after `--` if your shell passes it through):
 *   --write          apply, rather than printing what would change
 *   --teams          only resolve team ids, and write src/data/teams.js
 *   --limit N        first N clubs, for a smoke test (cannot be written)
 *   --clubs "A,B"    refetch only these clubs, merging into the committed
 *                    roster — the cheap way to fix a club that went wrong
 *   --no-wikipedia   API-Football portraits only
 *   --rpm N          requests per minute (default 10, the free tier limit)
 *
 * On rate limits: the free plan allows 10 requests a minute, and a full
 * refresh needs one or two per club. Calls are therefore paced, and a 429
 * is retried rather than dropped — a refresh takes a few minutes and does
 * not need supervising. Run `--teams` once and commit the result; every
 * later refresh then costs one call per club instead of two.
 *
 * Needs API_FOOTBALL_KEY. Either export it or, with Node 22:
 *
 *   node --env-file=.env scripts/refresh-squad.mjs --write
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CURATED, CLUBS, CLUB_QUERY, matchDetail, normalize } from "../src/data/squad.js";
import { ROSTER as PREVIOUS } from "../src/data/roster.js";
import { TEAM_IDS, TEAM_NAMES } from "../src/data/teams.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "..", "src", "data", "roster.js");
const TEAMS_FILE = join(HERE, "..", "src", "data", "teams.js");

const HOST = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";

/* Read at call time, not at import: --env-file and any wrapper that sets
 * the variable get to run first. */
const key = () => process.env.API_FOOTBALL_KEY;

/* Read at call time, for the same reason the key is: a caller — the test
 * suite included — gets to set argv before main runs. */
const argv = () => process.argv.slice(2);
const flag = (n) => argv().includes(n);
const argOf = (n) => {
  const a = argv();
  const i = a.indexOf(n);
  return i >= 0 ? a[i + 1] : null;
};

const WRITE = () => flag("--write");
const NO_WIKI = () => flag("--no-wikipedia");
const TEAMS_ONLY = () => flag("--teams");
const LIMIT = () => Number(argOf("--limit")) || 0;
/* --clubs "Bayern,Al-Hilal" — refetch just these and merge into what is
 * already committed, instead of spending a call on all 23 to fix three. */
const ONLY_CLUBS = () => {
  const raw = argOf("--clubs");
  return raw ? raw.split(",").map((c) => c.trim()).filter(Boolean) : null;
};
const RPM = () => Number(argOf("--rpm")) || 10;

/* The free plan allows 10 requests a minute and answers 429 the moment
 * you exceed it, so the gap is derived from --rpm rather than discovered
 * the hard way. */
const gapMs = () => Math.ceil(60000 / Math.max(1, RPM()));

/* RapidAPI fronts the same API behind different auth headers. */
const authHeaders = () =>
  HOST.includes("rapidapi")
    ? { "x-rapidapi-key": key(), "x-rapidapi-host": HOST }
    : { "x-apisports-key": key() };

let calls = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;

async function throttle() {
  const wait = lastCall + gapMs() - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

/* A 429 is a "come back shortly", not a failure. Honour Retry-After when
 * they send one, otherwise back off and try again; only a run of them is
 * treated as fatal for that club. */
async function call(path, attempt = 1) {
  await throttle();
  calls++;

  const res = await fetch(`https://${HOST}/${path}`, {
    headers: { ...authHeaders(), Accept: "application/json" },
  });

  if (res.status === 429) {
    if (attempt > 4) throw new Error(`rate limited after ${attempt} attempts on ${path}`);
    const after = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(after) && after > 0 ? after * 1000 : gapMs() * 2 ** attempt;
    process.stdout.write(`    rate limited, waiting ${Math.round(backoff / 1000)}s\n`);
    await sleep(backoff);
    return call(path, attempt + 1);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);

  const body = await res.json();
  // API-Football answers 200 with a populated `errors` field for auth and
  // quota problems, so res.ok alone is not success.
  if (body?.errors && Object.keys(body.errors).length) {
    throw new Error(`${path}: ${JSON.stringify(body.errors)}`);
  }
  return Array.isArray(body?.response) ? body.response : [];
}

/* Our display names are short ("Man City", "Atlético"); theirs are not,
 * and they are not always what we would guess either — "Bayern Munich" is
 * "Bayern München" to them. So score the hits instead of demanding an
 * exact string, and always report what was chosen: a club silently
 * resolving to a reserve side is the failure that looks like no failure.
 *
 * Returns { id, name, exact } or null. */
async function resolveTeam(club) {
  const known = TEAM_IDS[club];
  if (known) return { id: known, name: TEAM_NAMES[club] || "(from teams.js)", exact: true, cached: true };

  const query = CLUB_QUERY[club] || club;
  const hits = await call(`teams?search=${encodeURIComponent(query)}`);
  if (!hits.length) return null;

  const want = normalize(query);
  const wanted = new Set(want.split(" ").filter(Boolean));

  /* Prefer, in order: the same name, a name containing all our words, a
   * name sharing most words. Reserve and youth sides are pushed down —
   * they carry the parent's name and would otherwise win on a tie. */
  const scored = hits.map((h) => {
    const name = h.team?.name || "";
    const n = normalize(name);
    const words = new Set(n.split(" ").filter(Boolean));
    const shared = [...wanted].filter((w) => words.has(w)).length;

    let score = shared / Math.max(1, wanted.size);
    if (n === want) score += 2;
    else if (n.startsWith(want) || n.includes(want)) score += 1;
    /* Women's and youth sides carry the parent club's name and would
     * otherwise win on a tie. API-Football suffixes the women's team with
     * a bare "W" — "Bayern Munich W" — which is easy to miss and did in
     * fact win Bayern on the first live run. */
    if (/(^|\s)(w|ii|b|u1[6-9]|u2[0-3]|reserve|reserves|women|fem|femenino|feminin|feminine|academy|youth)(\s|$)/.test(n))
      score -= 4;
    if (h.team?.national) score -= 2;

    return { id: h.team?.id, name, score, exact: n === want };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.id ? best : null;
}

async function fetchClub(club) {
  const team = await resolveTeam(club);
  if (!team) return { club, found: [], why: "no team id" };

  const squads = await call(`players/squads?team=${team.id}`);
  const roster = squads?.[0]?.players;
  if (!Array.isArray(roster)) return { club, found: [], team, why: "no squad returned" };

  const found = [];
  const unplaced = [];
  for (const person of roster) {
    const detail = matchDetail(person.name, club);
    if (!detail) {
      unplaced.push(person.name);
      continue; // not one of ours
    }
    const curated = detail.player;
    const photo = person.photo || null;
    const prev = PREVIOUS[curated.name];

    found.push({
      name: curated.name,
      club,
      age: Number.isFinite(person.age) ? person.age : null,
      photo,
      /* Keep the downloaded copy when the source image hasn't moved — a
       * squad refresh should not silently throw away public/players/. If
       * the remote URL changed, the copy is stale, so drop it and let
       * fetch-photos pull the new one. */
      local: prev && prev.local && prev.photo === photo ? prev.local : null,
      /* Kept for the caller, not for roster.js: how sure the name match
       * was, and where we expected this player to be. */
      _precision: detail.precision,
      _curatedClub: curated.club,
      _apiName: person.name,
    });
  }
  return { club, found, team, squadSize: roster.length, unplaced };
}

/* ------------------------------------------------------------------ *
 *  Wikipedia, for the portraits API-Football had nothing for. Same
 *  lookup api/photo.js used to do per request, run once here instead.
 * ------------------------------------------------------------------ */
const WIKI_TITLE = {
  Rodri: "Rodri (footballer, born 1996)",
  Gavi: "Gavi (footballer)",
  Vitinha: "Vitinha (footballer, born 2000)",
  Ederson: "Ederson (footballer, born 1993)",
  Alisson: "Alisson Becker",
  Endrick: "Endrick (footballer, born 2006)",
  "Kim Min-jae": "Kim Min-jae (footballer)",
};

async function wikipediaPhoto(name) {
  const title = (WIKI_TITLE[name] || name).replace(/ /g, "_");
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        headers: {
          "Api-User-Agent": "MoreOrLess/1.0 (https://github.com/) contact via repo issues",
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const thumb = data?.thumbnail?.source;
    return thumb ? thumb.replace(/\/\d+px-/, "/640px-") : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 *  Generating roster.js. Keys are sorted so a refresh that changes one
 *  player produces a one-line diff rather than a reshuffled file.
 * ------------------------------------------------------------------ */
export function renderTeams(ids, names) {
  const clubs = Object.keys(ids).sort((a, b) => a.localeCompare(b));
  const line = (m) => clubs.map((c) => `  ${JSON.stringify(c)}: ${JSON.stringify(m[c])},`).join("\n");

  return `/* ------------------------------------------------------------------ *
 *  TEAM IDS — our club names to API-Football's numeric team ids.
 *
 *  Generated by \`npm run refresh-squad:teams\`, then committed. Caching
 *  them halves the cost of every later refresh: a squad fetch needs the
 *  id, and looking it up is a second request per club against a free
 *  tier of 100 a day.
 *
 *  Safe to edit by hand. If a club resolved to the wrong team — a
 *  reserve side, a namesake in another country — correct the number here
 *  and the refresh will use it as given, without searching again.
 *
 *  Empty is fine: any club missing from this map is looked up on demand.
 * ------------------------------------------------------------------ */
export const TEAM_IDS = {
${line(ids)}
};

/* What each id resolved to, for eyeballing. Not used at runtime — it is
 * here so a wrong mapping is obvious in review rather than showing up as
 * a club that mysteriously returns no players. */
export const TEAM_NAMES = {
${line(names)}
};
`;
}

export function renderRoster(entries, fetchedAt) {
  const names = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  const body = names
    .map((name) => {
      const e = entries[name];
      const parts = [
        `club: ${JSON.stringify(e.club)}`,
        `age: ${e.age === null ? "null" : e.age}`,
        `photo: ${e.photo ? JSON.stringify(e.photo) : "null"}`,
      ];
      // Only written once a copy exists, so an untouched roster stays terse.
      if (e.local) parts.push(`local: ${JSON.stringify(e.local)}`);
      return `  ${JSON.stringify(name)}: { ${parts.join(", ")} },`;
    })
    .join("\n");

  return `/* ------------------------------------------------------------------ *
 *  ROSTER — the fetched half of the squad data.
 *
 *  Generated. Do not edit by hand; run
 *
 *    npm run refresh-squad -- --write
 *
 *  which pulls current club, age and portrait for every curated player
 *  from API-Football and rewrites this file. Committing the result is the
 *  point: the deployed game reads it as a plain module and never calls
 *  anybody's API.
 *
 *  Empty is a valid state. Until the first refresh the game runs on the
 *  curated club and age in squad.js, with monogram portraits.
 * ------------------------------------------------------------------ */
export const FETCHED_AT = ${JSON.stringify(fetchedAt)};

export const ROSTER = {
${body}
};
`;
}

/* ------------------------------------------------------------------ */

export async function main() {
  if (!key()) {
    console.error(
      "API_FOOTBALL_KEY is not set.\n" +
        "Copy .env.example to .env, add your key, and run:\n" +
        "  node --env-file=.env scripts/refresh-squad.mjs --write"
    );
    process.exit(1);
  }

  const picked = ONLY_CLUBS();
  if (picked) {
    const unknown = picked.filter((c) => !CLUBS.includes(c));
    if (unknown.length) {
      console.error(`Not clubs in SQUAD: ${unknown.join(", ")}\nKnown: ${CLUBS.join(", ")}`);
      process.exit(1);
    }
  }
  const clubs = picked ? picked : LIMIT() ? CLUBS.slice(0, LIMIT()) : CLUBS;

  if (TEAMS_ONLY()) {
    console.log(`Resolving ${clubs.length} club(s) to team ids, ~${gapMs() / 1000}s apart\n`);
    const ids = { ...TEAM_IDS };
    const names = { ...TEAM_NAMES };
    const unsure = [];

    for (const club of clubs) {
      try {
        const t = await resolveTeam(club);
        if (!t) {
          console.log(`  ${club.padEnd(16)} not found`);
          continue;
        }
        ids[club] = t.id;
        names[club] = t.name;
        const mark = t.cached ? "cached" : t.exact ? "exact " : "fuzzy ";
        if (!t.cached && !t.exact) unsure.push(`${club} -> ${t.name}`);
        console.log(`  ${club.padEnd(16)} ${mark}  ${String(t.id).padStart(6)}  ${t.name}`);
      } catch (e) {
        console.log(`  ${club.padEnd(16)} failed — ${e.message}`);
      }
    }

    if (unsure.length) {
      console.log(`\n  ! check these — the name is not an exact match:`);
      for (const u of unsure) console.log(`      ${u}`);
      console.log(`    Wrong? Edit the id in src/data/teams.js; it is used as given.`);
    }

    if (!WRITE()) {
      console.log(`\nDry run. Re-run with --write to save src/data/teams.js.`);
      return;
    }
    await writeFile(TEAMS_FILE, renderTeams(ids, names));
    console.log(`\nWrote ${Object.keys(ids).length} team id(s) to ${TEAMS_FILE}`);
    console.log("Review the names, then commit. Later refreshes reuse these.");
    return;
  }

  const cached = clubs.filter((c) => TEAM_IDS[c]).length;
  console.log(
    `Fetching ${clubs.length} club(s) from API-Football at ${RPM()}/min` +
      (cached ? ` (${cached} team id(s) cached)` : "") +
      `\n`
  );

  /* A partial run starts from what is committed, so the clubs it does not
   * visit keep their entries instead of being dropped. */
  const entries = picked ? { ...PREVIOUS } : {};
  const clubProblems = [];
  const conflicts = [];
  const transfers = [];
  const unplacedByClub = {};
  const resolvedTeams = { ...TEAM_IDS };
  const resolvedNames = { ...TEAM_NAMES };

  // Sequential on purpose: a refresh is not in a hurry, and the smaller
  // plans rate-limit per minute.
  for (const club of clubs) {
    try {
      const { found, why, team, squadSize, unplaced } = await fetchClub(club);
      if (unplaced) unplacedByClub[club] = unplaced;
      if (why) clubProblems.push(`${club}: ${why}`);
      if (team) {
        resolvedTeams[club] = team.id;
        resolvedNames[club] = team.name;
      }

      for (const p of found) {
        const seen = entries[p.name];
        if (seen && seen.club !== p.club) {
          /* Two squads both claim him. Being at the club we already have
           * him at outranks everything — Galatasaray's Ederson and
           * Atalanta's are different men with identical names, and only
           * the club tells them apart. Confidence of the name match
           * breaks the remaining ties; an even tie keeps the first and
           * says so rather than picking silently. */
          const rank = (e) =>
            (e._curatedClub === e.club ? 2 : 0) +
            (e._precision === "full" || e._precision === "alias" ? 1 : 0);
          const better = rank(p) > rank(seen);
          conflicts.push(
            `${p.name}: ${seen.club} ("${seen._apiName}", ${seen._precision}) vs ` +
              `${p.club} ("${p._apiName}", ${p._precision}) — kept ${better ? p.club : seen.club}`
          );
          if (!better) continue;
        }
        if (p._curatedClub !== p.club) {
          transfers.push(`${p.name}: ${p._curatedClub} -> ${p.club}`);
        }
        entries[p.name] = p;
      }

      const expected = CURATED.filter((c) => c.club === club).length;
      const note = found.length === expected ? "" : `  (curated: ${expected})`;
      process.stdout.write(
        `  ${club.padEnd(16)} ${String(found.length).padStart(2)} of ${String(squadSize ?? "?").padStart(2)}` +
          `  ${team ? team.name : "—"}${note}\n`
      );
    } catch (e) {
      clubProblems.push(`${club}: ${e.message}`);
      process.stdout.write(`  ${club.padEnd(16)} failed — ${e.message}\n`);
    }
  }

  const noPhoto = Object.values(entries).filter((e) => !e.photo);
  if (noPhoto.length && !NO_WIKI()) {
    console.log(`\nAsking Wikipedia for ${noPhoto.length} missing portrait(s)`);
    for (const e of noPhoto) {
      e.photo = await wikipediaPhoto(e.name);
      const prev = PREVIOUS[e.name];
      if (prev && prev.local && prev.photo === e.photo) e.local = prev.local;
    }
  }

  /* Report against what is committed today, so the diff is the point. */
  const changes = [];
  for (const [name, next] of Object.entries(entries)) {
    const prev = PREVIOUS[name];
    if (!prev) {
      changes.push(`+ ${name} (new)`);
    } else {
      if (prev.club !== next.club) changes.push(`~ ${name}: ${prev.club} -> ${next.club}`);
      if (prev.age !== next.age) changes.push(`~ ${name}: age ${prev.age} -> ${next.age}`);
      if (!prev.photo && next.photo) changes.push(`~ ${name}: portrait found`);
      if (prev.photo && !next.photo) changes.push(`~ ${name}: portrait lost`);
      if (prev.local && !next.local) changes.push(`~ ${name}: local copy stale, re-fetch needed`);
    }
  }

  const matched = Object.keys(entries).length;
  const scope = picked ? CURATED.filter((c) => picked.includes(c.club)).length : CURATED.length;
  const withPhoto = Object.values(entries).filter((e) => e.photo).length;
  const missing = CURATED.filter((p) => !entries[p.name]).map((p) => p.name);

  console.log(`\n  ${matched}/${CURATED.length} curated players resolved`);
  console.log(`  ${withPhoto}/${matched} with a portrait`);
  console.log(`  ${calls} API call(s) used`);

  if (missing.length) {
    console.log(`\n  ! ${missing.length} curated player(s) not found:`);
    for (const p of CURATED.filter((c) => !entries[c.name])) {
      /* Show what his club's squad was actually called, narrowed to names
       * sharing a word with his, so a name written in a shape we don't
       * recognise is one glance away from an entry in NAME_ALIASES. */
      const pool = unplacedByClub[p.club] || [];
      const mine = new Set(normalize(p.name).split(" ").filter(Boolean));
      const near = pool.filter((n) =>
        normalize(n).split(" ").some((w) => w.length > 2 && mine.has(w))
      );
      const hint = near.length
        ? `  their squad has: ${near.slice(0, 3).map((n) => JSON.stringify(n)).join(", ")}`
        : pool.length
          ? ""
          : `  (${p.club} returned no unmatched names — he may have left)`;
      console.log(`      ${p.name.padEnd(24)} ${p.club.padEnd(14)}${hint}`);
    }
    console.log(
      `    A name in a shape we don't recognise goes in NAME_ALIASES in\n` +
        `    src/data/squad.js, keyed by what the API calls him.`
    );
  }
  if (clubProblems.length) {
    console.log(`\n  ! club problems:`);
    for (const p of clubProblems) console.log(`      ${p}`);
  }
  if (conflicts.length) {
    console.log(`\n  ! ${conflicts.length} player(s) claimed by two squads:`);
    for (const c of conflicts) console.log(`      ${c}`);
  }
  if (transfers.length) {
    console.log(`\n  ${transfers.length} club change(s) — check these are real transfers:`);
    for (const t of transfers) console.log(`      ${t}`);
  }
  if (changes.length) {
    console.log(`\n  changes vs the committed roster:`);
    for (const c of changes.slice(0, 40)) console.log(`      ${c}`);
    if (changes.length > 40) console.log(`      … and ${changes.length - 40} more`);
  } else {
    console.log(`\n  no changes vs the committed roster`);
  }

  /* A thin result usually means a renamed club or a quota wall part-way
   * through, not that everyone left football. Overwriting a good roster
   * with it would be the expensive mistake, so refuse unless forced. */
  if (!picked && matched < CURATED.length / 2 && Object.keys(PREVIOUS).length && !flag("--force")) {
    console.error(
      `\nRefusing to write: only ${matched} of ${CURATED.length} resolved, ` +
        `and roster.js currently has ${Object.keys(PREVIOUS).length}.\n` +
        `Re-run when the API is healthy, or pass --force if this is really right.`
    );
    process.exit(1);
  }

  if (!WRITE()) {
    console.log(`\nDry run. Re-run with --write to apply.`);
    return;
  }
  if (LIMIT()) {
    console.error(
      `\nRefusing to write a --limit run: it would drop the clubs it skipped.\n` +
        `To refresh specific clubs without losing the rest, use --clubs "A,B".`
    );
    process.exit(1);
  }

  /* Drop the bookkeeping fields; roster.js carries only what the game reads. */
  const clean = {};
  for (const [name, e] of Object.entries(entries)) {
    clean[name] = { club: e.club, age: e.age, photo: e.photo, local: e.local };
  }

  await writeFile(TARGET, renderRoster(clean, new Date().toISOString().slice(0, 10)));
  if (Object.keys(resolvedTeams).length) {
    await writeFile(TEAMS_FILE, renderTeams(resolvedTeams, resolvedNames));
    console.log(`Cached ${Object.keys(resolvedTeams).length} team id(s) to ${TEAMS_FILE}`);
  }
  console.log(`\nWrote ${matched} player(s) to ${TARGET}`);
  console.log("Review the diff, run npm run check, then commit.");
}

if (process.argv[1] && process.argv[1].endsWith("refresh-squad.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
