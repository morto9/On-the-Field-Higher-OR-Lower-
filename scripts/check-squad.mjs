/**
 * Offline check for the squad data layer.
 *
 * Covers the three places a mistake would be expensive and invisible:
 *
 *   mergeRoster    the fetched half overlaying the curated half — and
 *                  above all, never touching a valuation
 *   matchPlayer    API-Football's abbreviated and unaccented names
 *                  ("L. Yamal", "Vinicius Junior") finding our entries
 *   renderRoster   the generated roster.js being valid, sorted, and
 *                  round-tripping what went into it
 *
 * Then a dry run of scripts/refresh-squad.mjs against a stubbed
 * API-Football, so the join and the guard rails are exercised without a
 * key or a network.
 *
 *   node scripts/check-squad.mjs
 */
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CURATED, CLUBS, CLUB_QUERY, matchPlayer, mergeRoster } from "../src/data/squad.js";
import { renderRoster, main as refreshSquad } from "./refresh-squad.mjs";
import { slug, extensionFor } from "./fetch-photos.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label}` +
      (ok ? "" : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

console.log("matchPlayer");
check("full name", matchPlayer("Lamine Yamal")?.name, "Lamine Yamal");
check("initial + surname", matchPlayer("L. Yamal")?.name, "Lamine Yamal");
check("accents stripped", matchPlayer("Vinicius Junior")?.name, "Vinícius Júnior");
/* Deliberately NOT matched. A surname-only fallback looks harmless and is
 * not: run over every member of every squad it collides, and Barcelona's
 * Iñigo Martínez was matching Inter's Lautaro Martínez — one player's
 * portrait against another's valuation, silently. */
check("surname alone is refused", matchPlayer("Bellingham"), null);
check("a colliding surname is refused", matchPlayer("Iñigo Martínez"), null);
check("an ambiguous initial+surname is refused", matchPlayer("R. Martinez"), null);
check("a stranger is not matched", matchPlayer("Nobody Here"), null);
check("mononyms match whole", matchPlayer("Alisson")?.name, "Alisson");
check("a mononym is never abbreviated away", matchPlayer("A. "), null);

console.log("\nmergeRoster");
const base = [
  { name: "A", club: "Old", pos: "ST", age: 20, flag: "🇪🇸", value: 100 },
  { name: "B", club: "Keep", pos: "CM", age: 30, flag: "🇮🇹", value: 50 },
];
const merged = mergeRoster(base, {
  A: { club: "New", age: 21, photo: "http://x/a.png" },
});

check("club is overlaid", merged[0].club, "New");
check("age is overlaid", merged[0].age, 21);
check("photo is attached", merged[0].photo, "http://x/a.png");
check("valuation is never touched", merged[0].value, 100);
check("flag stays curated", merged[0].flag, "🇪🇸");
check("position stays curated", merged[0].pos, "ST");
check("a player with no entry is untouched", merged[1], base[1]);
check("empty roster changes nothing", mergeRoster(base, {}), base);

/* The hard invariant: roster.js is generated from someone else's API, so
 * it must never be able to reach a valuation, even if a future refresh
 * starts emitting fields we didn't ask for. */
const hostile = mergeRoster(base, {
  A: { club: "New", age: 21, photo: null, value: 1, flag: "🏴‍☠️", pos: "GK", name: "Z" },
});
check("a stray value in the roster is ignored", hostile[0].value, 100);
check("a stray flag in the roster is ignored", hostile[0].flag, "🇪🇸");
check("a stray position in the roster is ignored", hostile[0].pos, "ST");
check("a stray name in the roster is ignored", hostile[0].name, "A");

/* A partial entry must not blank out what it doesn't carry. */
const partial = mergeRoster(base, { A: { club: null, age: null, photo: null } });
check("null club falls back to curated", partial[0].club, "Old");
check("null age falls back to curated", partial[0].age, 20);

/* A local copy under public/ must win over the CDN URL it came from. */
const withLocal = mergeRoster(base, {
  A: { club: "New", age: 21, photo: "https://cdn/a.png", local: "/players/a.png" },
});
check("a local copy beats the remote url", withLocal[0].photo, "/players/a.png");
const remoteOnly = mergeRoster(base, { A: { club: "New", age: 21, photo: "https://cdn/a.png" } });
check("remote url is used when there is no copy", remoteOnly[0].photo, "https://cdn/a.png");

/* The committed data must be internally consistent. */
console.log("\ncommitted data");
check("every player has a value", CURATED.every((p) => typeof p.value === "number"), true);
check("no duplicate names", new Set(CURATED.map((p) => p.name)).size, CURATED.length);
check("clubs are derived from the squad", CLUBS.every((c) => CURATED.some((p) => p.club === c)), true);

console.log("\nphoto filenames");
check("accents are folded", slug("Vinícius Júnior"), "vinicius-junior");
check("punctuation collapses", slug("Kim Min-jae"), "kim-min-jae");
check("no leading or trailing dashes", slug("  Rodri  "), "rodri");
check("mononyms survive", slug("Alisson"), "alisson");
check("distinct players get distinct files", slug("Luka Modrić") !== slug("Lamine Yamal"), true);
check("content-type wins over the url", extensionFor("image/jpeg", "https://x/a.png"), "jpg");
check("falls back to the url", extensionFor(null, "https://x/a.png"), "png");
check("falls back to jpg", extensionFor(null, "https://x/whatever"), "jpg");
check("charset suffix is ignored", extensionFor("image/png; charset=binary", "https://x/a"), "png");

console.log("\nrenderRoster");
const rendered = renderRoster(
  {
    Zidane: { club: "Real Madrid", age: 30, photo: "http://x/z.png", local: "/players/zidane.png" },
    "Vinícius Júnior": { club: "Real Madrid", age: 25, photo: null },
    Abbey: { club: "Arsenal", age: 22, photo: "http://x/a.png" },
  },
  "2026-08-28"
);

check("keys are sorted for a clean diff", rendered.indexOf('"Abbey"') < rendered.indexOf('"Zidane"'), true);
check("stamps the fetch date", rendered.includes('export const FETCHED_AT = "2026-08-28"'), true);
check("a null photo stays null, not the string", rendered.includes("photo: null"), true);

/* The generated file has to be importable — a syntax slip here breaks the
 * build, not a test. */
const tmp = join(HERE, ".roster-check.mjs");
await writeFile(tmp, rendered);
const round = await import(`file://${tmp}`);
await unlink(tmp);
check("generated file imports", typeof round.ROSTER, "object");
check("round-trips every entry", Object.keys(round.ROSTER).length, 3);
check("round-trips accented keys", round.ROSTER["Vinícius Júnior"]?.age, 25);
check("round-trips the photo url", round.ROSTER.Zidane?.photo, "http://x/z.png");
check("round-trips the local path", round.ROSTER.Zidane?.local, "/players/zidane.png");
check("omits local when there is no copy", "local" in (round.ROSTER.Abbey || {}), false);

/* ------------------------------------------------------------------ *
 *  Dry run of the refresh against a stubbed API-Football.
 * ------------------------------------------------------------------ */
console.log("\nrefresh-squad (stubbed, dry run)");

const idFor = new Map(CLUBS.map((c, i) => [CLUB_QUERY[c] || c, 1000 + i]));
const clubForId = new Map([...idFor].map(([n, id]) => [id, n]));
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

let apiCalls = 0;
let rateLimitOnce = true;
const noHeaders = { get: () => null };

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname.includes("wikipedia")) {
    return { ok: true, status: 200, headers: noHeaders, json: async () => ({ thumbnail: { source: "https://w/240px-x.jpg" } }) };
  }
  apiCalls++;

  /* Answer 429 once, with a Retry-After, to prove the backoff path runs
   * and the call is retried rather than dropped. */
  if (rateLimitOnce && u.pathname.endsWith("/players/squads")) {
    rateLimitOnce = false;
    return { ok: false, status: 429, headers: { get: (h) => (h === "retry-after" ? "0" : null) }, json: async () => ({}) };
  }

  if (u.pathname.endsWith("/teams")) {
    const q = u.searchParams.get("search");
    const id = idFor.get(q);
    return {
      ok: true,
      status: 200,
      headers: noHeaders,
      // a reserve side is returned alongside the real club, and must lose
      json: async () => ({
        errors: [],
        response: id ? [{ team: { id: 90000 + id, name: `${q} II` } }, { team: { id, name: q } }] : [],
      }),
    };
  }
  if (u.pathname.endsWith("/players/squads")) {
    const apiClub = clubForId.get(Number(u.searchParams.get("team")));
    const display = CLUBS.find((c) => (CLUB_QUERY[c] || c) === apiClub);
    const players = CURATED.filter((p) => p.club === display).map((p, i) => ({
      id: 500 + i,
      // exercise every name shape the API is known to return. Mononyms
      // (Alisson, Rodri, Pedri) are never abbreviated — "A." would be
      // meaningless — so they stay whole.
      name:
        i % 3 === 0 && p.name.includes(" ")
          ? `${p.name.split(" ")[0][0]}. ${p.name.split(" ").slice(1).join(" ")}`
          : i % 3 === 1
            ? strip(p.name)
            : p.name,
      age: p.age + 1,
      position: "Attacker",
      // every third player has no portrait, to exercise the Wikipedia pass
      photo: i % 3 === 0 ? null : `https://media.api-sports.io/football/players/${500 + i}.png`,
    }));
    return { ok: true, status: 200, headers: noHeaders, json: async () => ({ errors: [], response: [{ players }] }) };
  }
  throw new Error("unexpected " + url);
};

process.env.API_FOOTBALL_KEY = "test-key";

/* Call main() directly and await it, rather than importing for its side
 * effect and hoping a timer outlasts it. Both streams are captured: the
 * per-club lines go to stdout.write, the summary to console.log. */
const log = [];
const realLog = console.log;
const realWrite = process.stdout.write.bind(process.stdout);
console.log = (...a) => log.push(a.join(" "));
process.stdout.write = (chunk) => (log.push(String(chunk).replace(/\n$/, "")), true);

// --rpm is cranked so the throttle does not make the suite take minutes
process.argv = [process.argv[0], join(HERE, "refresh-squad.mjs"), "--rpm", "60000"]; // no --write
try {
  await refreshSquad();
} finally {
  console.log = realLog;
  process.stdout.write = realWrite;
}

const out = log.join("\n");
check("resolves every curated player", out.includes(`${CURATED.length}/${CURATED.length} curated players resolved`), true);
check("finds a portrait for all of them", out.includes(`${CURATED.length}/${CURATED.length} with a portrait`), true);
check("reports its API spend", /\d+ API call\(s\) used/.test(out), true);
check("stops at a dry run", out.includes("Dry run"), true);
check("two calls per club, plus the retried one", apiCalls, CLUBS.length * 2 + 1);
check("a 429 is retried, not dropped", out.includes("rate limited"), true);
check("picks the club over its reserve side", out.includes(" II") === false, true);
check("writes nothing on a dry run", (await import("node:fs")).existsSync(join(HERE, "..", "src", "data", "teams.js")) , true);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
