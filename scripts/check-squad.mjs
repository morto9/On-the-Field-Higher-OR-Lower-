/**
 * Offline check for api/squad.js.
 *
 * API-Football needs a key and a network, so CI and a fresh clone cannot
 * call it. This stubs the API instead and asserts the parts that actually
 * carry risk: that curated valuations survive the join, that API-Football's
 * abbreviated and unaccented names still match ("L. Yamal", "Vinicius
 * Junior"), that a squad member we hold no valuation for is dropped rather
 * than dealt without a number, and that every failure mode degrades to the
 * built-in roster instead of a broken deck.
 *
 *   node scripts/check-squad.mjs
 */
process.env.API_FOOTBALL_KEY = "test-key";

const { SQUAD, CLUB_QUERY, CLUBS } = await import(
  "../src/data/squad.js"
);

let calls = 0;
let mode = "ok";

/* Fake team ids, and squads rebuilt from the curated array so the join has
 * something realistic to chew on — including API-Football's abbreviated
 * first names and unaccented spellings. */
const idFor = new Map(CLUBS.map((c, i) => [CLUB_QUERY[c] || c, 1000 + i]));
const clubForId = new Map([...idFor].map(([name, id]) => [id, name]));

const strip = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function apiName(name, i) {
  const parts = name.split(" ");
  if (i % 3 === 0 && parts.length > 1) return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
  if (i % 3 === 1) return strip(name);
  return name;
}

globalThis.fetch = async (url) => {
  calls++;
  const u = new URL(url);
  if (mode === "dead") throw new Error("network down");
  if (mode === "quota") {
    return { ok: true, json: async () => ({ errors: { requests: "limit reached" }, response: [] }) };
  }

  if (u.pathname.endsWith("/teams")) {
    const q = u.searchParams.get("search");
    const id = idFor.get(q);
    return {
      ok: true,
      json: async () => ({
        errors: [],
        response: id
          ? [{ team: { id, name: q } }, { team: { id: 9999, name: `${q} U21` } }]
          : [],
      }),
    };
  }

  if (u.pathname.endsWith("/players/squads")) {
    const id = Number(u.searchParams.get("team"));
    const apiClub = clubForId.get(id);
    const display = CLUBS.find((c) => (CLUB_QUERY[c] || c) === apiClub);
    const members = SQUAD.filter((p) => p.club === display).map((p, i) => ({
      id: 500 + i,
      name: apiName(p.name, i),
      age: p.age + 1, // API is authoritative on age; prove it wins
      position: "Attacker",
      photo: `https://media.api-sports.io/football/players/${500 + i}.png`,
    }));
    // plus a squad member we hold no valuation for — must be dropped
    members.push({ id: 1, name: "Some Reserve Keeper", age: 19, position: "Goalkeeper", photo: "x.png" });
    return { ok: true, json: async () => ({ errors: [], response: [{ players: members }] }) };
  }
  throw new Error("unexpected " + url);
};

const { default: handler } = await import(
  "../api/squad.js"
);

function mockRes() {
  const r = { headers: {}, body: null, code: null };
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
}

async function run(label) {
  calls = 0;
  const res = mockRes();
  await handler({ query: {} }, res);
  const b = res.body;
  console.log(
    `${label.padEnd(22)} status=${res.code} source=${b.source} players=${b.players.length} calls=${calls}` +
      (b.reason ? ` reason="${b.reason}"` : "")
  );
  return b;
}

let failed = 0;
function check(label, cond) {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}`);
}

const ok = await run("happy path");
console.log("  stats:", JSON.stringify(ok.stats));

const curated = SQUAD.find((p) => p.name === "Lamine Yamal");
const sample = ok.players.find((p) => p.name === "Lamine Yamal");

check("every curated player resolved", ok.players.length === SQUAD.length);
check("valuation survives the join", sample && sample.value === curated.value);
check("age comes from the API", sample && sample.age === curated.age + 1);
check("curated position wins", sample && sample.pos === curated.pos);
check("portrait attached", !!(sample && sample.photo));
check("unvalued squad member dropped", !ok.players.some((p) => p.name === "Some Reserve Keeper"));
check("no duplicate players", new Set(ok.players.map((p) => p.name)).size === ok.players.length);
check("every player has a value", ok.players.every((p) => typeof p.value === "number"));
check("every club has a kit", ok.players.every((p) => CLUBS.includes(p.club)));

const warm = await run("warm cache");
check("team ids reused when warm", calls < CLUBS.length * 2);
check("warm result still complete", warm.players.length === SQUAD.length);

mode = "quota";
const q = await run("quota exhausted");
check("quota wall falls back", q.source === "static" && q.players.length === 0);

mode = "dead";
const d = await run("network dead");
check("dead network falls back", d.source === "static" && d.players.length === 0);

mode = "ok";
delete process.env.API_FOOTBALL_KEY;
const { default: h2 } = await import("../api/squad.js?nokey");
const r2 = mockRes();
await h2({ query: {} }, r2);
console.log(`${"no key".padEnd(22)} status=${r2.code} source=${r2.body.source} reason="${r2.body.reason}"`);
check("missing key falls back", r2.body.source === "static" && r2.code === 200);

/* A blip must not poison the team-id cache: fail once, then recover. */
process.env.API_FOOTBALL_KEY = "test-key";
const { default: h3 } = await import(
  "../api/squad.js?recovery"
);
mode = "dead";
const a = mockRes(); await h3({ query: {} }, a);
mode = "ok";
const b = mockRes(); await h3({ query: {} }, b);
console.log(`${"recovery after blip".padEnd(22)} first=${a.body.source} then=${b.body.source} players=${b.body.players.length}`);
check("a blip does not poison the team-id cache", b.body.players.length === SQUAD.length);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
