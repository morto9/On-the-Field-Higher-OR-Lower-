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
import { renderRoster } from "./refresh-squad.mjs";

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
check("surname alone", matchPlayer("Bellingham")?.name, "Jude Bellingham");
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

/* The committed data must be internally consistent. */
console.log("\ncommitted data");
check("every player has a value", CURATED.every((p) => typeof p.value === "number"), true);
check("no duplicate names", new Set(CURATED.map((p) => p.name)).size, CURATED.length);
check("clubs are derived from the squad", CLUBS.every((c) => CURATED.some((p) => p.club === c)), true);

console.log("\nrenderRoster");
const rendered = renderRoster(
  {
    Zidane: { club: "Real Madrid", age: 30, photo: "http://x/z.png" },
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

/* ------------------------------------------------------------------ *
 *  Dry run of the refresh against a stubbed API-Football.
 * ------------------------------------------------------------------ */
console.log("\nrefresh-squad (stubbed, dry run)");

const idFor = new Map(CLUBS.map((c, i) => [CLUB_QUERY[c] || c, 1000 + i]));
const clubForId = new Map([...idFor].map(([n, id]) => [id, n]));
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

let apiCalls = 0;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname.includes("wikipedia")) {
    return { ok: true, json: async () => ({ thumbnail: { source: "https://w/240px-x.jpg" } }) };
  }
  apiCalls++;
  if (u.pathname.endsWith("/teams")) {
    const q = u.searchParams.get("search");
    const id = idFor.get(q);
    return {
      ok: true,
      json: async () => ({ errors: [], response: id ? [{ team: { id, name: q } }] : [] }),
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
    return { ok: true, json: async () => ({ errors: [], response: [{ players }] }) };
  }
  throw new Error("unexpected " + url);
};

process.env.API_FOOTBALL_KEY = "test-key";
const log = [];
const realLog = console.log;
console.log = (...a) => log.push(a.join(" "));
process.argv = [process.argv[0], join(HERE, "refresh-squad.mjs")]; // no --write
await import("./refresh-squad.mjs?run");
await new Promise((r) => setTimeout(r, 50));
console.log = realLog;

const out = log.join("\n");
check("resolves every curated player", out.includes(`${CURATED.length}/${CURATED.length} curated players resolved`), true);
check("finds a portrait for all of them", out.includes(`${CURATED.length}/${CURATED.length} with a portrait`), true);
check("reports its API spend", /\d+ API call\(s\) used/.test(out), true);
check("stops at a dry run", out.includes("Dry run"), true);
check("two calls per club", apiCalls, CLUBS.length * 2);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
