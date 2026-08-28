/**
 * Offline check for scripts/refresh-values.mjs.
 *
 * The fetch itself can't be tested here — it needs Transfermarkt and a
 * residential-looking IP. What can be tested is everything that happens to
 * the response afterwards, which is where the damage would be: misreading a
 * value, taking a number off the wrong row, or corrupting src/data/squad.js
 * on the way out.
 *
 * The fixture below is shaped like their search results, not copied from
 * them. If the real markup has moved, this still passes and the run still
 * fails — that's what --debug is for.
 *
 *   node scripts/check-values.mjs
 */
import { parseValue, applyValues, extract } from "./refresh-values.mjs";

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label}` +
      (ok ? "" : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

console.log("parseValue");
check('"€180.00m" -> 180', parseValue("€180.00m"), 180);
check('"€1.20m" -> 1.2', parseValue("€1.20m"), 1.2);
check('"€900k" -> 0.9', parseValue("€900k"), 0.9);
check('"€1,200.00m" -> 1200 (comma is thousands)', parseValue("€1,200.00m"), 1200);
check('"  €75.00m \\n" -> 75 (whitespace)', parseValue("  €75.00m \n"), 75);
check('"-" -> null', parseValue("-"), null);
check('"" -> null', parseValue(""), null);
check("null -> null", parseValue(null), null);

/* Shaped like their results table: several hits for one query, the wanted
 * player not first, and a row carrying no value at all. */
const FIXTURE = `
<table class="items"><tbody>
  <tr>
    <td class="hauptlink"><a href="/rodri/profil/spieler/111">Rodrigo Moreno</a></td>
    <td>Right Winger</td>
    <td>€8.00m</td>
  </tr>
  <tr>
    <td class="hauptlink"><a href="/rodri/profil/spieler/222">Rodri</a></td>
    <td>Defensive Midfield</td>
    <td>€110.00m</td>
  </tr>
  <tr>
    <td class="hauptlink"><a href="/rodri-jr/profil/spieler/333">Rodri Sánchez</a></td>
    <td>Midfield</td>
    <td>-</td>
  </tr>
</tbody></table>`;

console.log("\nextract");
const rodri = extract(FIXTURE, "Rodri");
check("picks the exact name, not the first row", rodri && rodri.value, 110);
check("not flagged fuzzy on an exact hit", !!(rodri && rodri.fuzzy), false);
check("captures the profile href", rodri && rodri.href, "/rodri/profil/spieler/222");

/* Accents differ between our list and theirs; the match is normalised. */
const ACCENT = `
<table class="items"><tbody>
  <tr><td class="hauptlink"><a href="/x/profil/spieler/9">Vinicius Junior</a></td><td>€170.00m</td></tr>
</tbody></table>`;
const vini = extract(ACCENT, "Vinícius Júnior");
check("matches across accents", vini && vini.value, 170);
check("accent match is exact, not fuzzy", !!(vini && vini.fuzzy), false);

/* A query that finds nobody we asked for must be flagged, never taken
 * silently — a wrong number here is invisible in the game. */
const wrong = extract(FIXTURE, "Somebody Else");
check("no exact match is flagged fuzzy", !!(wrong && wrong.fuzzy), true);
check("empty results -> null", extract("<html></html>", "Rodri"), null);

console.log("\napplyValues");
const SRC = `/* Valuations are rounded market estimates, not official figures. */
export const SQUAD = [
  P("Lamine Yamal", "Barcelona", "RW", 18, "🇪🇸", 180),
  P("Vinícius Júnior", "Real Madrid", "LW", 25, "🇧🇷", 170),
  P("Luka Modrić", "AC Milan", "CM", 40, "🇭🇷", 4),
];
`;

const one = applyValues(SRC, [["Lamine Yamal", 200]]);
check("updates the target value", /P\("Lamine Yamal".*, 200\)/.test(one.out), true);
check("leaves the neighbours alone", /P\("Vinícius Júnior".*, 170\)/.test(one.out), true);
check("keeps the comment", one.out.startsWith("/* Valuations"), true);
check("nothing reported missing", one.missed, []);

const many = applyValues(SRC, [
  ["Vinícius Júnior", 165],
  ["Luka Modrić", 3],
]);
check("handles accented names", /P\("Vinícius Júnior".*, 165\)/.test(many.out), true);
check("handles a decimal-free downgrade", /P\("Luka Modrić".*, 3\)/.test(many.out), true);

const frac = applyValues(SRC, [["Luka Modrić", 2.5]]);
check("writes fractional values", /P\("Luka Modrić".*, 2\.5\)/.test(frac.out), true);

const gone = applyValues(SRC, [["Nobody Here", 50]]);
check("reports a name it could not find", gone.missed, ["Nobody Here"]);
check("leaves the file untouched when nothing matched", gone.out, SRC);

/* The line count must never change — a refresh edits numbers, not shape. */
check(
  "line count is stable",
  applyValues(SRC, [["Lamine Yamal", 1]]).out.split("\n").length,
  SRC.split("\n").length
);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
