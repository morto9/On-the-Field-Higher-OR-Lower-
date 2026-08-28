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
npm run check    # offline tests for the data layer
```

There is nothing else to configure. The game is a static site: all its data is
committed, so `npm run dev` is the real thing, not a degraded local mode, and a
production deploy needs no environment, no API key and no serverless runtime.

## How it's put together

```
index.html
src/data/squad.js   curated: valuations, kits, flags, name matching
src/data/roster.js  generated: club, age, portrait — committed, not fetched
src/App.jsx         the game — audio engine and UI
src/main.jsx        mount
src/styles.css      the ~50 utility classes the app uses, hand-written
scripts/            the refresh commands and their offline checks
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

### Where the data comes from

Both sources are pulled by **commands you run**, never by the running game.
Nothing is fetched at runtime, from anybody. That means no API key in
production, no quota spent on traffic, no rate limit to design around, and no
third-party service that can be down while someone is playing. It also means the
data is exactly as fresh as the last time you ran a refresh — which is the right
trade here, because neither source changes fast.

```bash
npm run refresh-squad  -- --write   # API-Football: club, age, portrait
npm run refresh-values -- --write   # Transfermarkt: valuations
```

Both are dry runs by default: they print the diff and change nothing until you
pass `--write`. Read it, run `npm run check`, commit.

#### The split

**API-Football does not publish market values.** Valuations are Transfermarkt's
dataset and aren't licensed to them; the closest thing on offer is `/transfers`,
which gives the fee of a completed move as a display string (`"€45M"`, `"Free"`,
`"Loan"`, often `"N/A"`) — a past fee, not a current valuation. So the number you
guess against stays hand-maintained in `SQUAD`, and the API supplies the fields
that actually rot:

| field | source | lives in |
| --- | --- | --- |
| value | Transfermarkt, via `refresh-values` | `squad.js` |
| name, flag, position | hand-written | `squad.js` |
| club | API-Football, via `refresh-squad` | `roster.js` |
| age | API-Football | `roster.js` |
| photo | API-Football, Wikipedia as fallback | `roster.js` |

The two files are also a safety boundary. `refresh-squad` only ever rewrites
`roster.js`, so a bad run can't reach your valuations; `refresh-values` only ever
edits the numbers in `squad.js`. `mergeRoster` overlays them at import, naming
the three fields it takes and ignoring anything else `roster.js` happens to
carry — a test pins that, so a future refactor can't let generated data reach a
valuation.

`roster.js` being empty is a valid state: before the first refresh, or for a
player the API had nothing for, the game falls back to the curated club and age
and a monogram portrait.

#### refresh-squad

Resolves a team id per club, pulls `/players/squads`, and joins onto the curated
array by name. **Only players with a curated valuation are kept**, so every card
the game deals has a number behind it. Portraits come from API-Football first and
Wikipedia second, so the committed file ends up with a URL for as many players as
possible.

A full run costs about two calls per club — ~46 for the 23 clubs currently in
`SQUAD`, against a free tier of 100 a day. Spending that on a command a few times
a season is very different from spending it on traffic.

It refuses to write a `--limit` run (it would drop the clubs it skipped), and
refuses to overwrite a healthy `roster.js` with a run that resolved less than
half the squad — a quota wall part-way through shouldn't cost you the file.
`--force` overrides that if the shrinkage is real.

Names are the fragile part, because the two sources spell them differently.
`matchPlayer` tries three widths, narrowest first: the full name, then initial
plus surname (so API-Football's `"L. Yamal"` finds `"Lamine Yamal"`), then the
surname alone when it's unambiguous in our list. Accents are stripped on both
sides, so `"Vinicius Junior"` and `"Vinícius Júnior"` land together.

#### refresh-values

Transfermarkt publishes no API, so this reads the same pages a browser would:

```bash
npm run refresh-values                    # dry run, prints the diff
npm run refresh-values -- --write         # applies it to src/data/squad.js
npm run refresh-values -- --only "Rodri"  # one player
npm run refresh-values -- --debug "Pedri" # dump the HTML it is being served
```

It rewrites only the value argument of each matching line, so the comments and
ordering in `squad.js` survive a refresh untouched. It never writes without
`--write`, and it refuses to take a value off a row whose name doesn't match
exactly — a wrong number would be invisible in the game, so a near-miss is
reported instead of guessed at.

Values move in batches a few times a season, so a live lookup would buy nothing
over a periodic refresh. Transfermarkt is an Axel Springer company, so their database also carries the EU *sui generis*
database right, which is separate from copyright and aimed squarely at
substantial extraction. Read their terms before pointing this anywhere public,
and credit them on screen.

The command never writes without `--write`, and it refuses to take a value off a
row whose name doesn't match exactly — a wrong number would be invisible in the
game, so a near-miss is reported instead of guessed at.

Everything that knows what their HTML looks like is in the `SELECTORS` block at
the top of `scripts/refresh-values.mjs`. When their markup moves — and it will —
that block is the only thing to change; `--debug` dumps what you're actually
being served so you can fix it against the real page.

### Photos

Portrait URLs are resolved once by `refresh-squad` and committed into
`roster.js`: API-Football first, then Wikipedia for whoever it missed (with a
short title override map for the ambiguous ones — Rodri, Gavi, Vitinha, Ederson,
Alisson, Endrick, Kim Min-jae). `--no-wikipedia` skips that second pass.

Anyone still without a URL falls through to the oversized shirt-back initials, so
a missing portrait degrades quietly instead of breaking a round.

The committed URLs point at `media.api-sports.io` and Wikipedia's CDN, so a
browser still loads the images from there — that costs no API quota, but it is a
hotlink. If you'd rather not depend on either CDN, download the images into
`public/` and rewrite the URLs; check each source's terms on redistribution
first.

**On licensing:** Wikipedia images are mostly CC BY-SA, which requires per-image
attribution rather than the single line on the intro screen. Taking
API-Football's portraits first shrinks that exposure to the handful of players it
misses; `--no-wikipedia` removes it entirely, at the cost of a few monograms.

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
- All data drifts between refreshes; nothing updates automatically, by design.
  A scheduled job (a CI workflow on a cron, opening a PR with the diff) would
  keep it current without putting either source in the request path.
- Nationality is curated too: `/players/squads` doesn't return it, so a player
  added straight from the API would have no flag.
