/**
 * Refresh market values from Transfermarkt, in place, in src/data/squad.js.
 *
 * This is a maintenance command, not part of the app. Nothing at runtime
 * talks to Transfermarkt: you run this after a transfer window, read the
 * diff, and commit the result. Players of the game never generate a single
 * request to their site.
 *
 * That is deliberate. Market values move in batches a few times a season,
 * so a live lookup would buy nothing over a periodic refresh while adding
 * latency, rate limits and an outage surface — and re-serving their feed to
 * the public is a different proposition from refreshing a committed
 * constant. Transfermarkt publishes no API; this reads the same pages a
 * browser would. Their data, their terms — check both before pointing this
 * at anything public, and credit them on screen (the intro line has room).
 *
 *   node scripts/refresh-values.mjs                # dry run, prints a diff
 *   node scripts/refresh-values.mjs --write        # applies it
 *   node scripts/refresh-values.mjs --only "Rodri" # one player
 *   node scripts/refresh-values.mjs --limit 5      # first five, for a smoke test
 *   node scripts/refresh-values.mjs --debug "Pedri"  # dump the HTML it sees
 *
 * If the numbers come back empty, the markup moved. Everything this depends
 * on about their page structure is in SELECTORS below — fix it there, and
 * use --debug to see what you are actually being served.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as cheerio from "cheerio";

import { SQUAD, normalize } from "../src/data/squad.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "..", "src", "data", "squad.js");

/* ------------------------------------------------------------------ *
 *  SELECTORS — everything that knows what their HTML looks like.
 *  This is the part that rots. When it does, only this block changes.
 * ------------------------------------------------------------------ */
const SELECTORS = {
  /* Quick search. One request per player: slower than scraping a squad
   * page per club, but each player is independent, so one bad match or
   * one changed page can't take the rest of the run down with it. */
  search: (name) =>
    `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}`,

  /* Rows of the player results table. */
  rows: "table.items > tbody > tr",

  /* Within a row: the player's name, and the market value cell.
   * Their tables put the name in an anchor carrying the profile href and
   * the value in the last cell. */
  rowName: "td.hauptlink a, a.spielprofil_tooltip",
  rowLink: "a[href*='/profil/spieler/']",
  rowValue: "td:last-child",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const WRITE = flag("--write");
const ONLY = value("--only");
const DEBUG = value("--debug");
const LIMIT = Number(value("--limit")) || 0;

/* Their pages are served from behind a bot filter. A browser-shaped
 * request and a gap between them is the difference between data and a
 * wall of 403s; from a datacenter IP you may get the wall regardless. */
const GAP_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* "€180.00m" -> 180 · "€900k" -> 0.9 · "-" -> null */
export function parseValue(text) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  const m = clean.match(/([\d.,]+)\s*(m|k|bn)?/i);
  if (!m) return null;

  // Their thousands separator is a comma and their decimal point a dot.
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") return Math.round((n / 1000) * 100) / 100;
  if (unit === "bn") return n * 1000;
  return n;
}

/* Pick the row that is actually the player we asked for. The search is
 * fuzzy — "Rodri" returns several — so an exact normalised name wins, and
 * a run of near-misses is reported rather than guessed at. */
function pickRow($, wanted) {
  const target = normalize(wanted);
  const candidates = [];

  $(SELECTORS.rows).each((_, el) => {
    const row = $(el);
    const name = row.find(SELECTORS.rowName).first().text().trim();
    if (!name) return;
    const href = row.find(SELECTORS.rowLink).first().attr("href") || null;
    const raw = row.find(SELECTORS.rowValue).last().text().trim();
    candidates.push({ name, href, raw, value: parseValue(raw) });
  });

  if (!candidates.length) return null;

  const exact = candidates.find((c) => normalize(c.name) === target);
  if (exact) return exact;

  // Fall back to the first row that at least carries a value, but say so.
  const withValue = candidates.find((c) => c.value !== null);
  return withValue ? { ...withValue, fuzzy: true } : null;
}

/* Split from the fetch so the parsing can be tested against fixtures
 * without a network. */
export function extract(html, wanted) {
  return pickRow(cheerio.load(html), wanted);
}

async function lookup(name) {
  return extract(await get(SELECTORS.search(name)), name);
}

/* ------------------------------------------------------------------ *
 *  Rewriting src/data/squad.js
 *
 *  Edits the value argument of the matching P(...) line and leaves every
 *  other byte alone, so the comments and ordering in that file survive a
 *  refresh untouched.
 * ------------------------------------------------------------------ */
export function applyValues(source, updates) {
  let out = source;
  const missed = [];

  for (const [name, next] of updates) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(P\\("${escaped}",\\s*"[^"]*",\\s*"[^"]*",\\s*\\d+,\\s*"[^"]*",\\s*)([\\d.]+)(\\))`
    );
    if (!re.test(out)) {
      missed.push(name);
      continue;
    }
    out = out.replace(re, `$1${next}$3`);
  }

  return { out, missed };
}

/* ------------------------------------------------------------------ */

async function main() {
  if (DEBUG) {
    const html = await get(SELECTORS.search(DEBUG));
    const $ = cheerio.load(html);
    console.log(`fetched ${html.length} bytes for ${JSON.stringify(DEBUG)}`);
    console.log(`rows matching ${JSON.stringify(SELECTORS.rows)}: ${$(SELECTORS.rows).length}`);
    console.log("\n--- first 3 rows, as parsed ---");
    $(SELECTORS.rows)
      .slice(0, 3)
      .each((i, el) => {
        const row = $(el);
        console.log(`[${i}] name=${JSON.stringify(row.find(SELECTORS.rowName).first().text().trim())}`);
        console.log(`    value=${JSON.stringify(row.find(SELECTORS.rowValue).last().text().trim())}`);
      });
    const dump = join(HERE, "..", "debug-transfermarkt.html");
    await writeFile(dump, html);
    console.log(`\nfull HTML written to ${dump}`);
    return;
  }

  let players = SQUAD;
  if (ONLY) players = players.filter((p) => normalize(p.name) === normalize(ONLY));
  if (LIMIT) players = players.slice(0, LIMIT);

  if (!players.length) {
    console.error(ONLY ? `No curated player matches ${JSON.stringify(ONLY)}` : "Nothing to do");
    process.exit(1);
  }

  console.log(`Checking ${players.length} player(s) against Transfermarkt\n`);

  const changes = [];
  const unchanged = [];
  const problems = [];

  for (const p of players) {
    try {
      const hit = await lookup(p.name);
      if (!hit || hit.value === null) {
        problems.push({ name: p.name, why: "no value found" });
      } else if (hit.fuzzy) {
        // Never silently take a value off a row we are not sure about.
        problems.push({ name: p.name, why: `no exact match (closest: ${hit.name} @ ${hit.raw})` });
      } else if (hit.value !== p.value) {
        changes.push({ name: p.name, from: p.value, to: hit.value });
      } else {
        unchanged.push(p.name);
      }
    } catch (e) {
      problems.push({ name: p.name, why: e.message });
    }
    await sleep(GAP_MS);
  }

  for (const c of changes) {
    const arrow = c.to > c.from ? "↑" : "↓";
    console.log(`  ${arrow} ${c.name.padEnd(24)} €${c.from}m -> €${c.to}m`);
  }
  if (unchanged.length) console.log(`\n  = ${unchanged.length} unchanged`);
  if (problems.length) {
    console.log(`\n  ! ${problems.length} not updated:`);
    for (const p of problems) console.log(`      ${p.name.padEnd(24)} ${p.why}`);
  }

  if (!changes.length) {
    console.log("\nNothing to write.");
    return;
  }

  if (!WRITE) {
    console.log(`\n${changes.length} change(s). Re-run with --write to apply.`);
    return;
  }

  const source = await readFile(TARGET, "utf8");
  const { out, missed } = applyValues(
    source,
    changes.map((c) => [c.name, c.to])
  );
  if (missed.length) {
    console.error(`\nCould not locate in ${TARGET}: ${missed.join(", ")}`);
  }
  await writeFile(TARGET, out);
  console.log(`\nWrote ${changes.length - missed.length} value(s) to ${TARGET}`);
  console.log("Review the diff, run npm run check, then commit.");
}

/* Importable for the offline tests; only runs when invoked directly. */
if (process.argv[1] && process.argv[1].endsWith("refresh-values.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
