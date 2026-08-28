/**
 * Download the portraits in src/data/roster.js into public/players/ and
 * point the roster at the local copies.
 *
 * Run this after refresh-squad. That command records where each portrait
 * lives on someone else's CDN; this one takes a copy, so the deployed game
 * serves every image from its own origin.
 *
 * Why bother, when the remote URL already works in the browser: it works
 * until it doesn't. Hotlinking is a request the host can refuse at any
 * time — a referrer check, a CORS rule, a rate limit, a moved file — and
 * when it does, an <img> just fails and you get the monogram back with no
 * error anywhere. A committed copy cannot be withdrawn, and it loads on the
 * same connection as the rest of the page.
 *
 *   npm run fetch-photos                 # dry run: what it would download
 *   npm run fetch-photos -- --write      # download and rewrite roster.js
 *   npm run fetch-photos -- --write --force   # re-download everything
 *
 * Committing public/players/ is the point. Check the terms of whichever
 * source a given image came from before republishing it — API-Football's
 * portraits and Wikipedia's are not under the same licence, and the
 * Wikipedia ones are mostly CC BY-SA, which wants per-image attribution.
 */
import { writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ROSTER, FETCHED_AT } from "../src/data/roster.js";
import { renderRoster } from "./refresh-squad.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER_FILE = join(HERE, "..", "src", "data", "roster.js");
const OUT_DIR = join(HERE, "..", "public", "players");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const FORCE = args.includes("--force");

/* The filename is derived from the player's name, so it is stable across
 * runs and a re-download overwrites rather than accumulating. */
export function slug(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/* Trust the served content-type over the URL's extension: these CDNs
 * rewrite formats, and a .png that is really a JPEG confuses nothing but
 * looks wrong in the diff. */
export function extensionFor(contentType, url) {
  const clean = (contentType || "").split(";")[0].trim().toLowerCase();
  if (EXT[clean]) return EXT[clean];
  const m = url.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

const kb = (n) => `${Math.round(n / 1024)}kB`;

async function download(url) {
  const res = await fetch(url, {
    headers: {
      // Some CDNs answer differently, or not at all, to an unlabelled client.
      "User-Agent": "MoreOrLess/1.0 (portrait cache; contact via repo issues)",
      Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty response");
  // A hotlink block often returns a courtesy HTML page with a 200.
  if (buf.subarray(0, 512).toString("utf8").trimStart().toLowerCase().startsWith("<!doctype")) {
    throw new Error("got HTML, not an image (hotlink blocked?)");
  }

  return { buf, ext: extensionFor(res.headers.get("content-type"), url) };
}

async function main() {
  const names = Object.keys(ROSTER);
  if (!names.length) {
    console.error(
      "src/data/roster.js is empty — there is nothing to download.\n" +
        "Run the squad refresh first:\n" +
        "  npm run refresh-squad -- --write"
    );
    process.exit(1);
  }

  const todo = [];
  const already = [];
  const noSource = [];

  for (const name of names) {
    const entry = ROSTER[name];
    if (!entry.photo) {
      noSource.push(name);
    } else if (entry.local && !FORCE) {
      already.push(name);
    } else {
      todo.push(name);
    }
  }

  console.log(
    `${names.length} player(s) in the roster: ` +
      `${todo.length} to fetch, ${already.length} already local, ${noSource.length} with no portrait\n`
  );

  if (!todo.length) {
    console.log(FORCE ? "Nothing to do." : "Nothing to do. Pass --force to re-download.");
    return;
  }

  if (!WRITE) {
    for (const name of todo.slice(0, 15)) console.log(`  would fetch  ${name}`);
    if (todo.length > 15) console.log(`  … and ${todo.length - 15} more`);
    console.log(`\nDry run. Re-run with --write to download into public/players/.`);
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });

  const updated = { ...ROSTER };
  let bytes = 0;
  const failures = [];

  for (const name of todo) {
    const url = ROSTER[name].photo;
    try {
      const { buf, ext } = await download(url);
      const file = `${slug(name)}.${ext}`;
      await writeFile(join(OUT_DIR, file), buf);
      updated[name] = { ...ROSTER[name], local: `/players/${file}` };
      bytes += buf.length;
      console.log(`  ok    ${name.padEnd(24)} ${kb(buf.length).padStart(7)}  ${file}`);
    } catch (e) {
      failures.push({ name, why: e.message });
      console.log(`  fail  ${name.padEnd(24)} ${e.message}`);
    }
  }

  await writeFile(ROSTER_FILE, renderRoster(updated, FETCHED_AT));

  const files = await readdir(OUT_DIR);
  let total = 0;
  for (const f of files) total += (await stat(join(OUT_DIR, f))).size;

  console.log(`\n  downloaded ${todo.length - failures.length} of ${todo.length} (${kb(bytes)})`);
  console.log(`  public/players/ now holds ${files.length} file(s), ${kb(total)} total`);

  if (failures.length) {
    console.log(`\n  ! ${failures.length} failed:`);
    for (const f of failures) console.log(`      ${f.name.padEnd(24)} ${f.why}`);
    console.log(
      `\n  Those keep their remote URL and still load in the browser, so the\n` +
        `  game is unaffected. Re-run to retry just them.`
    );
  }

  console.log(`\nCommit public/players/ along with roster.js — that's what makes them permanent.`);
}

if (process.argv[1] && process.argv[1].endsWith("fetch-photos.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
