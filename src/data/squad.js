/* ------------------------------------------------------------------ *
 *  SQUAD DATA
 *
 *  Two halves, merged at import into the SQUAD the game deals from.
 *
 *    CURATED (below)   hand-maintained: name, valuation, flag, position
 *    roster.js         fetched: club, age, photo
 *
 *  Nothing here is fetched at runtime. Both halves are committed, so the
 *  deployed game makes no third-party calls, needs no API key, and cannot
 *  fail because someone else's service is down. The fetched half is
 *  refreshed by a command you run:
 *
 *    npm run refresh-squad     -- --write   (API-Football: club, age, photo)
 *    npm run refresh-values    -- --write   (Transfermarkt: valuations)
 *
 *  The split is also a safety boundary: refresh-squad only ever rewrites
 *  roster.js, so a bad run cannot touch the valuations, and refresh-values
 *  only ever edits the numbers below.
 * ------------------------------------------------------------------ */

import { ROSTER } from "./roster.js";

/* ------------------------------------------------------------------ *
 *  KIT — club colour washes. Two stops per club, used as the panel
 *  gradient so every card is lit in the player's own colours.
 * ------------------------------------------------------------------ */
export const KIT = {
  "Real Madrid": ["#5B5BD6", "#0A0E1C"],
  "Barcelona": ["#1E40AF", "#6D1A2E"],
  "Man City": ["#0EA5C4", "#062B3A"],
  "Arsenal": ["#DC2626", "#3B0A0A"],
  "Liverpool": ["#C0392B", "#2A0808"],
  "Chelsea": ["#1D4ED8", "#08123A"],
  "Man United": ["#E11D48", "#320810"],
  "Tottenham": ["#3F4A5C", "#0B0F18"],
  "Newcastle": ["#1F2937", "#050608"],
  "Aston Villa": ["#6D1A3A", "#0F2A5C"],
  "Crystal Palace": ["#1D4ED8", "#6D1A2E"],
  "Brighton": ["#0284C7", "#062A45"],
  "Nottm Forest": ["#DC2626", "#2A0606"],
  "West Ham": ["#5B1220", "#0C3B4A"],
  "Bournemouth": ["#B91C1C", "#0B1220"],
  "Bayern": ["#DC2626", "#122A5C"],
  "Dortmund": ["#CA8A04", "#141414"],
  "Leverkusen": ["#DC2626", "#131313"],
  "RB Leipzig": ["#B91C1C", "#0A1F3C"],
  "Stuttgart": ["#B91C1C", "#111827"],
  "PSG": ["#1E3A8A", "#5B1220"],
  "Monaco": ["#B91C1C", "#1F2937"],
  "Lyon": ["#1D4ED8", "#5B1220"],
  "Inter": ["#0B1B4A", "#0A0A0A"],
  "AC Milan": ["#C1121F", "#0A0A0A"],
  "Juventus": ["#171717", "#3F3F46"],
  "Napoli": ["#0284C7", "#062A45"],
  "Atalanta": ["#1E3A8A", "#0A0A0A"],
  "Atlético": ["#C1121F", "#132A5C"],
  "Athletic Club": ["#C1121F", "#2A0606"],
  "Real Sociedad": ["#1D4ED8", "#0B1220"],
  "Villarreal": ["#CA8A04", "#1E3A8A"],
  "Sporting CP": ["#166534", "#052012"],
  "Benfica": ["#B91C1C", "#2A0606"],
  "Ajax": ["#B91C1C", "#111827"],
  "PSV": ["#B91C1C", "#0F172A"],
  "Galatasaray": ["#CA8A04", "#6D1A2E"],
  "Al-Nassr": ["#CA8A04", "#123A7A"],
  "Al-Hilal": ["#1D4ED8", "#08123A"],
  "Inter Miami": ["#E879A6", "#171717"],
};


const P = (name, club, pos, age, flag, value) => ({ name, club, pos, age, flag, value });


/* Valuations are rounded market estimates, not official figures.
 * Refreshed by scripts/refresh-values.mjs, which rewrites only the last
 * argument of each line. */
export const CURATED = [
  P("Lamine Yamal", "Barcelona", "RW", 18, "🇪🇸", 180),
  P("Jude Bellingham", "Real Madrid", "AM", 22, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 180),
  P("Erling Haaland", "Man City", "ST", 25, "🇳🇴", 180),
  P("Kylian Mbappé", "Real Madrid", "ST", 27, "🇫🇷", 170),
  P("Vinícius Júnior", "Real Madrid", "LW", 25, "🇧🇷", 170),
  P("Florian Wirtz", "Liverpool", "AM", 22, "🇩🇪", 140),
  P("Jamal Musiala", "Bayern", "AM", 22, "🇩🇪", 140),
  P("Pedri", "Barcelona", "CM", 23, "🇪🇸", 140),
  P("Bukayo Saka", "Arsenal", "RW", 24, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 140),
  P("Cole Palmer", "Chelsea", "AM", 23, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 130),
  P("Phil Foden", "Man City", "AM", 25, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 120),
  P("Federico Valverde", "Real Madrid", "CM", 27, "🇺🇾", 130),
  P("Rodri", "Man City", "DM", 29, "🇪🇸", 110),
  P("Declan Rice", "Arsenal", "DM", 27, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 110),
  P("Martin Ødegaard", "Arsenal", "AM", 27, "🇳🇴", 100),
  P("Lautaro Martínez", "Inter", "ST", 28, "🇦🇷", 100),
  P("Rodrygo", "Real Madrid", "RW", 25, "🇧🇷", 90),
  P("Eduardo Camavinga", "Real Madrid", "CM", 23, "🇫🇷", 90),
  P("Alexander Isak", "Liverpool", "ST", 26, "🇸🇪", 90),
  P("Moisés Caicedo", "Chelsea", "DM", 24, "🇪🇨", 90),
  P("Julián Álvarez", "Atlético", "ST", 26, "🇦🇷", 90),
  P("Gavi", "Barcelona", "CM", 21, "🇪🇸", 85),
  P("Khvicha Kvaratskhelia", "PSG", "LW", 25, "🇬🇪", 85),
  P("Harry Kane", "Bayern", "ST", 32, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 80),
  P("William Saliba", "Arsenal", "CB", 25, "🇫🇷", 80),
  P("Victor Osimhen", "Galatasaray", "ST", 27, "🇳🇬", 75),
  P("Rafael Leão", "AC Milan", "LW", 26, "🇵🇹", 75),
  P("Rúben Dias", "Man City", "CB", 28, "🇵🇹", 75),
  P("Joško Gvardiol", "Man City", "CB", 24, "🇭🇷", 75),
  P("Michael Olise", "Bayern", "RW", 24, "🇫🇷", 75),
  P("Nico Williams", "Athletic Club", "LW", 23, "🇪🇸", 70),
  P("João Neves", "PSG", "CM", 21, "🇵🇹", 70),
  P("Vitinha", "PSG", "CM", 26, "🇵🇹", 70),
  P("Xavi Simons", "Tottenham", "AM", 22, "🇳🇱", 70),
  P("Nicolò Barella", "Inter", "CM", 29, "🇮🇹", 70),
  P("Aurélien Tchouaméni", "Real Madrid", "DM", 26, "🇫🇷", 70),
  P("Enzo Fernández", "Chelsea", "CM", 25, "🇦🇷", 70),
  P("Trent Alexander-Arnold", "Real Madrid", "RB", 27, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 65),
  P("Achraf Hakimi", "PSG", "RB", 27, "🇲🇦", 65),
  P("Dominik Szoboszlai", "Liverpool", "CM", 25, "🇭🇺", 65),
  P("Bradley Barcola", "PSG", "LW", 23, "🇫🇷", 65),
  P("Benjamin Šeško", "Man United", "ST", 22, "🇸🇮", 65),
  P("Luis Díaz", "Bayern", "LW", 29, "🇨🇴", 65),
  P("Ryan Gravenberch", "Liverpool", "DM", 23, "🇳🇱", 60),
  P("Jules Koundé", "Barcelona", "RB", 27, "🇫🇷", 60),
  P("Ronald Araújo", "Barcelona", "CB", 26, "🇺🇾", 60),
  P("Warren Zaïre-Emery", "PSG", "CM", 20, "🇫🇷", 60),
  P("Dani Olmo", "Barcelona", "AM", 27, "🇪🇸", 60),
  P("Ollie Watkins", "Aston Villa", "ST", 30, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 55),
  P("Eberechi Eze", "Arsenal", "AM", 27, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 55),
  P("Kobbie Mainoo", "Man United", "CM", 20, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 55),
  P("Mohamed Salah", "Liverpool", "RW", 33, "🇪🇬", 50),
  P("Frenkie de Jong", "Barcelona", "CM", 28, "🇳🇱", 50),
  P("Alphonso Davies", "Bayern", "LB", 25, "🇨🇦", 50),
  P("Cody Gakpo", "Liverpool", "LW", 26, "🇳🇱", 50),
  P("Ousmane Dembélé", "PSG", "RW", 28, "🇫🇷", 50),
  P("Darwin Núñez", "Al-Hilal", "ST", 26, "🇺🇾", 45),
  P("Gianluigi Donnarumma", "Man City", "GK", 27, "🇮🇹", 45),
  P("Endrick", "Real Madrid", "ST", 19, "🇧🇷", 45),
  P("Arda Güler", "Real Madrid", "AM", 21, "🇹🇷", 45),
  P("Kaoru Mitoma", "Brighton", "LW", 28, "🇯🇵", 45),
  P("Morgan Gibbs-White", "Nottm Forest", "AM", 25, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 45),
  P("Marcus Rashford", "Barcelona", "LW", 28, "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 40),
  P("Rasmus Højlund", "Napoli", "ST", 23, "🇩🇰", 40),
  P("Ademola Lookman", "Atalanta", "LW", 28, "🇳🇬", 40),
  P("Kim Min-jae", "Bayern", "CB", 29, "🇰🇷", 38),
  P("Son Heung-min", "Inter Miami", "LW", 33, "🇰🇷", 12),
  P("Scott McTominay", "Napoli", "CM", 29, "🏴󠁧󠁢󠁳󠁣󠁴󠁿", 35),
  P("Amad Diallo", "Man United", "RW", 23, "🇨🇮", 35),
  P("Alisson", "Liverpool", "GK", 33, "🇧🇷", 28),
  P("Virgil van Dijk", "Liverpool", "CB", 34, "🇳🇱", 28),
  P("Ederson", "Galatasaray", "GK", 32, "🇧🇷", 22),
  P("Thibaut Courtois", "Real Madrid", "GK", 33, "🇧🇪", 25),
  P("Antoine Griezmann", "Atlético", "AM", 34, "🇫🇷", 25),
  P("Antonio Rüdiger", "Real Madrid", "CB", 32, "🇩🇪", 20),
  P("Kevin De Bruyne", "Napoli", "AM", 34, "🇧🇪", 20),
  P("Lionel Messi", "Inter Miami", "RW", 38, "🇦🇷", 18),
  P("Robert Lewandowski", "Barcelona", "ST", 37, "🇵🇱", 15),
  P("Neymar", "Al-Hilal", "LW", 34, "🇧🇷", 12),
  P("Federico Chiesa", "Liverpool", "RW", 28, "🇮🇹", 12),
  P("Cristiano Ronaldo", "Al-Nassr", "ST", 41, "🇵🇹", 10),
  P("Luka Modrić", "AC Milan", "CM", 40, "🇭🇷", 4),
];

/* ------------------------------------------------------------------ *
 *  NAME MATCHING
 *
 *  Joining a live squad to the valuations above means matching names
 *  written by two different sources. API-Football abbreviates some
 *  first names ("L. Yamal") and spells accents inconsistently, so the
 *  match is tried at three widths, narrowest first:
 *
 *    1. the whole name        lamine yamal
 *    2. initial + surname     l yamal
 *    3. surname alone         yamal      (only when unambiguous)
 *
 *  Accents are stripped on both sides, so "Vinícius" and "Vinicius"
 *  land on the same key.
 * ------------------------------------------------------------------ */

export function normalize(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* "Lamine Yamal" and "L. Yamal" both key to "l yamal". */
function initialKey(name) {
  const parts = normalize(name).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]} ${parts.slice(1).join(" ")}`;
}

function surnameKey(name) {
  const parts = normalize(name).split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/* Build the three lookup tables once. A surname shared by two players
 * in the list is dropped from the surname table rather than guessed at. */
function buildIndex(players) {
  const full = new Map();
  const initial = new Map();
  const surnameCount = new Map();
  const surname = new Map();

  for (const p of players) {
    full.set(normalize(p.name), p);
    const ik = initialKey(p.name);
    if (ik) initial.set(ik, p);
    const sk = surnameKey(p.name);
    if (sk) {
      surnameCount.set(sk, (surnameCount.get(sk) || 0) + 1);
      surname.set(sk, p);
    }
  }
  for (const [key, n] of surnameCount) if (n > 1) surname.delete(key);

  return { full, initial, surname };
}

const INDEX = buildIndex(CURATED);

/* Returns the curated entry an API-Football name refers to, or null. */
export function matchPlayer(name) {
  const f = INDEX.full.get(normalize(name));
  if (f) return f;
  const ik = initialKey(name);
  if (ik) {
    const i = INDEX.initial.get(ik);
    if (i) return i;
  }
  const sk = surnameKey(name);
  if (sk) {
    const s = INDEX.surname.get(sk);
    if (s) return s;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  CLUBS — our short display names are not what API-Football calls
 *  these teams. This maps display name -> the name to search the API
 *  with; anything not listed searches under its own name.
 * ------------------------------------------------------------------ */
export const CLUB_QUERY = {
  "Man City": "Manchester City",
  "Man United": "Manchester United",
  "Nottm Forest": "Nottingham Forest",
  "Bayern": "Bayern Munich",
  "Atlético": "Atletico Madrid",
  "PSG": "Paris Saint Germain",
  "Dortmund": "Borussia Dortmund",
  "Leverkusen": "Bayer Leverkusen",
  "RB Leipzig": "RB Leipzig",
  "Sporting CP": "Sporting CP",
  "Real Sociedad": "Real Sociedad",
};

/* The clubs we actually need squads for — derived, so adding a player
 * to SQUAD is the only edit needed to bring their club into the fetch. */
export const CLUBS = [...new Set(CURATED.map((p) => p.club))];

/* ------------------------------------------------------------------ *
 *  FLAGS — API-Football reports nationality as a country name. Covers
 *  the nations in SQUAD plus the rest of the usual football map, so a
 *  player swapped in tomorrow still gets a flag. Unknown -> null, and
 *  the card falls back to the curated flag.
 * ------------------------------------------------------------------ */
export const FLAGS = {
  Algeria: "🇩🇿", Angola: "🇦🇴", Argentina: "🇦🇷", Australia: "🇦🇺",
  Austria: "🇦🇹", Belgium: "🇧🇪", Bosnia: "🇧🇦", "Bosnia and Herzegovina": "🇧🇦",
  Brazil: "🇧🇷", Bulgaria: "🇧🇬", Cameroon: "🇨🇲", Canada: "🇨🇦",
  Chile: "🇨🇱", Colombia: "🇨🇴", "Costa Rica": "🇨🇷", Croatia: "🇭🇷",
  "Czech Republic": "🇨🇿", Czechia: "🇨🇿", Denmark: "🇩🇰", "DR Congo": "🇨🇩",
  Ecuador: "🇪🇨", Egypt: "🇪🇬", England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Finland: "🇫🇮",
  France: "🇫🇷", Gabon: "🇬🇦", Georgia: "🇬🇪", Germany: "🇩🇪",
  Ghana: "🇬🇭", Greece: "🇬🇷", Guinea: "🇬🇳", Hungary: "🇭🇺",
  Iceland: "🇮🇸", Iran: "🇮🇷", Ireland: "🇮🇪", Israel: "🇮🇱",
  Italy: "🇮🇹", "Ivory Coast": "🇨🇮", Jamaica: "🇯🇲", Japan: "🇯🇵",
  "Korea Republic": "🇰🇷", "South Korea": "🇰🇷", Mali: "🇲🇱", Mexico: "🇲🇽",
  Montenegro: "🇲🇪", Morocco: "🇲🇦", Netherlands: "🇳🇱", "New Zealand": "🇳🇿",
  Nigeria: "🇳🇬", "Northern Ireland": "🏴󠁧󠁢󠁮󠁩󠁲󠁿", Norway: "🇳🇴", Panama: "🇵🇦",
  Paraguay: "🇵🇾", Peru: "🇵🇪", Poland: "🇵🇱", Portugal: "🇵🇹",
  Romania: "🇷🇴", Russia: "🇷🇺", "Saudi Arabia": "🇸🇦", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  Senegal: "🇸🇳", Serbia: "🇷🇸", Slovakia: "🇸🇰", Slovenia: "🇸🇮",
  "South Africa": "🇿🇦", Spain: "🇪🇸", Sweden: "🇸🇪", Switzerland: "🇨🇭",
  Tunisia: "🇹🇳", Turkey: "🇹🇷", Türkiye: "🇹🇷", Ukraine: "🇺🇦",
  Uruguay: "🇺🇾", USA: "🇺🇸", "United States": "🇺🇸", Uzbekistan: "🇺🇿",
  Venezuela: "🇻🇪", Wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", Zambia: "🇿🇲", Zimbabwe: "🇿🇼",
};

/* ------------------------------------------------------------------ *
 *  POSITIONS — API-Football reports one of four coarse buckets. The
 *  curated position ("AM", "DM", "RW") is more specific than anything
 *  the API returns, so it wins; this is only the fallback for a player
 *  who arrives from the API without a curated entry.
 * ------------------------------------------------------------------ */
export const POSITION = {
  Goalkeeper: "GK",
  Defender: "DF",
  Midfielder: "MF",
  Attacker: "FW",
};

/* ------------------------------------------------------------------ *
 *  THE MERGE
 *
 *  What the game actually deals from. The curated entry is the base and
 *  roster.js overlays the fields API-Football is authoritative about, so
 *  a player who transferred appears under his new club and his age is
 *  right for today.
 *
 *  An empty or partial roster.js is normal — before the first refresh, or
 *  for a player the API had nothing for. Those keep their curated club and
 *  age and fall back to the shirt-back monogram for a portrait, which is
 *  exactly how the game behaved before any of this existed.
 * ------------------------------------------------------------------ */
export function mergeRoster(curated, roster) {
  return curated.map((p) => {
    const live = roster[p.name];
    if (!live) return p;
    return {
      ...p,
      club: live.club || p.club,
      age: Number.isFinite(live.age) ? live.age : p.age,
      /* A downloaded copy under public/ wins over the remote URL it came
       * from: same image, served from our own origin, so no third-party
       * CDN gets a say in whether it loads. */
      photo: live.local || live.photo || null,
    };
  });
}

export const SQUAD = mergeRoster(CURATED, ROSTER);
