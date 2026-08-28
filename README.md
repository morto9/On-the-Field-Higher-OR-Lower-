# More or Less

Higher-or-lower, played with football transfer valuations. One player's market
value is on the board; call whether the next one is worth more or less. Miss
once and the window shuts.

Built as a broadcast graphics package rather than a quiz: full-bleed panels lit
in each club's colours, an LED ticker that spins the value up, a stadium crowd
that surges between rounds, and a goal sound when you call it right.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
npm run check    # offline tests for the API-Football join
```

`npm run dev` serves the game but not the `/api` functions, so the roster is the
one committed in `src/data/squad.js` and portraits fall back to the monogram.
Use `vercel dev` with a `.env` (copy `.env.example`) to exercise the lookups
locally.

## How it's put together

```
index.html
api/squad.js        live roster from API-Football (Vercel function)
api/photo.js        Wikipedia photo fallback (Vercel function)
src/data/squad.js   valuations, kits, flags, name matching
src/App.jsx         the game — audio engine and UI
src/main.jsx        mount
src/styles.css      the ~50 utility classes the app uses, hand-written
scripts/            offline checks
```

There's no CSS framework and no state library. `styles.css` covers exactly the
utilities `App.jsx` references, which keeps the build to Vite and React alone.

### Player data

`SQUAD` in `src/data/squad.js` is a flat array of
`(name, club, position, age, flag, value)`. Values are rounded estimates in
millions of euros, not official figures — they're calibrated for a fun guessing
curve, not for accuracy.

`KIT` maps each club to the two-stop gradient its panel is painted with. Add a
club to `SQUAD` and add it to `KIT` too, or the panel falls back to grey.

### The API-Football half

**API-Football does not publish market values.** Valuations are Transfermarkt's
dataset and aren't licensed to them; the closest thing on offer is `/transfers`,
which gives the fee of a completed move as a display string (`"€45M"`, `"Free"`,
`"Loan"`, often `"N/A"`) — a past fee, not a current valuation. So the number you
guess against stays hand-maintained in `SQUAD`, and the API supplies the fields
that actually rot:

| field | source |
| --- | --- |
| value | curated in `src/data/squad.js` |
| name, flag, position | curated |
| club | API-Football — a player who moved appears under his new club |
| age | API-Football — correct today, not whenever the array was written |
| photo | API-Football — a licensed portrait |

`api/squad.js` resolves a team id per club, pulls `/players/squads`, and joins
the result onto `SQUAD` by name. **Only players with a curated valuation are
returned**, so every card the game deals has a number behind it.

Set `API_FOOTBALL_KEY` (see `.env.example`) to turn it on. Without it — or on a
timeout, a spent quota, or a join that comes back mostly empty — the function
answers `source:"static"` with an empty roster and the browser keeps playing off
the committed array. The game never depends on the API being up.

Names are the fragile part, because the two sources spell them differently.
`matchPlayer` tries three widths, narrowest first: the full name, then initial
plus surname (so API-Football's `"L. Yamal"` finds `"Lamine Yamal"`), then the
surname alone when it's unambiguous in our list. Accents are stripped on both
sides, so `"Vinicius Junior"` and `"Vinícius Júnior"` land together.

A cold refresh costs about two calls per club — ~46 for the 23 clubs currently in
`SQUAD`, against a free tier of 100 a day. The response is held at the edge for a
day (stale-served for a week), and resolved team ids are memoised on the warm
instance, which halves every refresh after the first.

`npm run check` exercises all of this against a stubbed API, so the join and the
fallbacks are testable without a key or a network.

### Photos

Wikipedia is now the **fallback**, behind API-Football's portraits — it only runs
for players `/api/squad` had no photo for, or when the API is unavailable.

`api/photo.js` asks Wikipedia for a player's lead image and returns the URL.
The browser never calls Wikipedia directly, so there are no cross-origin rules
to depend on, and the edge cache means one lookup per player serves everybody.
Article titles default to the player's name, with a short override map in
`WIKI_TITLE` for the ambiguous ones (Rodri, Gavi, Vitinha, Ederson, Alisson,
Endrick, Kim Min-jae).

Any lookup that misses falls through to the oversized shirt-back initials, so a
bad title or a dead network degrades quietly instead of breaking a round.

**On licensing:** Wikipedia images are mostly CC BY-SA, which requires per-image
attribution rather than the single line on the intro screen. Serving
API-Football's portraits first shrinks that exposure to the handful of players it
misses, but it doesn't remove it — either surface the `credit` URL `api/photo.js`
already returns for those, or drop the Wikipedia path once API coverage is good
enough.

### Sound

Everything is synthesised at runtime in the Web Audio API. No audio files.

- **Crowd bed** — three noise layers (rumble, roar, chatter) each drifting on
  its own LFO, with a surge every 6–13 seconds
- **Goal** — ball thud, net snap, ripple, then a filter-opening roar with
  scattered applause and a detuned stadium horn
- **Full time** — three pea-whistle blasts, crowd filtered away behind them
- **Ticker** — one blip per €1m, pitch climbing with the reveal

The audio context is created on the first tap of Kick off, which is what
browsers require.

## Known gaps

- One life. Three lives, or a "within €5m survives" rule, would help retention.
- The deck is fully random, so a trivial pair can follow a coin-flip pair.
  Biasing early rounds toward wide value gaps would make the difficulty curve
  feel designed.
- Best streak lives in React state, so it resets on refresh.
- No share card at full time.
- Valuations are still hand-maintained, so they drift between transfer windows.
  Refreshing them means editing `SQUAD` — the API can't do it.
- Nationality is curated too: `/players/squads` doesn't return it, so a player
  added straight from the API would have no flag.
