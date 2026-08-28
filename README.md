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
src/data/teams.js   generated: club -> API-Football team id, hand-editable
public/players/     downloaded portraits, served from our own origin
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
npm run refresh-squad:teams    # once: resolve club -> team id, and commit
npm run refresh-squad:write    # API-Football: club, age, portrait URLs
npm run fetch-photos:write     # download those portraits into public/
npm run refresh-values:write   # Transfermarkt: valuations
```

Drop the `:write` for a dry run — it prints what it would do and changes
nothing. Read it, run `npm run check`, commit.

The `:write` scripts exist because `npm run x -- --write` is unreliable:
npm on PowerShell can eat the flag, warn `Unknown cli config "--write"`, and
run the dry version. If you see that warning, use the `:write` script.

**Rate limits.** The free tier allows 10 requests a minute, so calls are paced
and a full refresh takes a few minutes — that is the throttle working, not a
hang. A 429 is retried, with `Retry-After` honoured. `--rpm N` raises the pace
on a paid plan. Run `refresh-squad:teams` once and commit `src/data/teams.js`;
every later refresh then costs one call per club instead of two.

**A fresh clone has no portraits.** `src/data/roster.js` ships empty, so every
player falls back to the shirt-back monogram until you run the first two
commands. That is the intended empty state, not a bug — but it is also the most
likely reason you are reading this section.

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
| photo | API-Football, Wikipedia as fallback | `roster.js` + `public/players/` |

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

Each club's line shows how many curated players it matched out of the squad
size, and flags the count when it differs from what we curate for that club —
which is how you spot a club resolving to the wrong team.

Names are the fragile part, because the two sources spell them differently.
`matchPlayer` tries two widths: the full name, then initial plus surname (so
API-Football's `"L. Yamal"` finds `"Lamine Yamal"`). Accents are stripped on both
sides, so `"Vinicius Junior"` and `"Vinícius Júnior"` land together.

**There is deliberately no surname-only fallback.** It looks harmless against one
player and isn't: the match runs over every member of every squad — hundreds of
names — and surnames collide. Barcelona's Iñigo Martínez was matching Inter's
Lautaro Martínez that way, dealing one player's portrait against another's
valuation with nothing on screen to show it. A missed player costs a monogram; a
wrong match corrupts the game invisibly, so the loose path is gone.

Two further guards, because a silent wrong answer is the failure mode that
matters here:

- An initial+surname key shared by two curated players is dropped rather than
  resolved by guesswork.
- If two squads both claim the same player, the refresh reports it and prefers
  the exact name match instead of letting the later club win.

Club changes are reported separately, so a real transfer is visible in the run
and a bad match doesn't hide among them.

Team lookup is scored rather than exact-matched — API-Football calls Bayern
"Bayern München", which no exact test on "Bayern Munich" will ever find — and
reserve, youth and women's sides are pushed down so they can't win a tie. Every
run prints the team it resolved to, and `teams.js` records the name alongside the
id: a club quietly resolving to the wrong side is the failure that looks like no
failure. If one is wrong, correct the id by hand and it's used as given.

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

Two steps, because finding an image and owning a copy of it are different jobs.

**`refresh-squad`** records *where* each portrait lives: API-Football first, then
Wikipedia for whoever it missed (with a short title override map for the
ambiguous ones — Rodri, Gavi, Vitinha, Ederson, Alisson, Endrick, Kim Min-jae).
`--no-wikipedia` skips that second pass. Those URLs point at someone else's CDN.

**`fetch-photos`** downloads them into `public/players/` and records the local
path alongside the remote one. `mergeRoster` prefers the local copy, so once
downloaded the game never touches a third-party host for an image.

That second step is worth doing because a hotlink is a request the host can
refuse at any time — a referrer check, a CORS rule, a rate limit, a moved file —
and when it does, an `<img>` simply fails. The monogram comes back and nothing is
logged anywhere, which makes it a genuinely annoying thing to debug. A committed
copy cannot be withdrawn.

Filenames are derived from the player's name (`vinicius-junior.jpg`), so they are
stable across runs and a re-download overwrites rather than accumulating. The
extension follows the served content-type, not the URL. A download that comes
back as an HTML page — the usual shape of a hotlink block returning 200 — is
detected and reported rather than saved as a broken image.

Failures are not fatal at any level: a player whose download failed keeps his
remote URL and still loads in the browser; a player with no portrait at all falls
through to the oversized shirt-back initials. Re-running retries only what is
missing, so the second run is cheap.

Re-running `refresh-squad` later preserves the copies you already have. It only
drops a local path when the *source* URL changed, which is exactly when the copy
has gone stale and should be re-fetched.

Commit `public/players/` — that is what makes them permanent. Expect a few MB for
the current squad. If that bothers you, run the files through an optimiser before
committing; nothing in the build touches them.

**On licensing:** downloading changes the question from linking to republishing,
so it is worth a look before you deploy. Wikipedia images are mostly CC BY-SA,
which wants per-image attribution rather than the single line on the intro
screen; `--no-wikipedia` avoids them entirely at the cost of a few monograms.
API-Football's portraits come under their own terms — check what your plan allows
for redistribution.

### The landing backdrop

The intro screen paints a match photo behind the title. Drop yours in at:

```
public/landing.jpg
```

That path is all the wiring there is — `LANDING_IMAGE` at the top of `App.jsx`
points at it, and Vite copies `public/` through to the build untouched. **No file
is committed**, and none is required: without one the CSS paints nothing over the
existing gradient and the screen looks as it always did.

It is composited rather than dropped in raw, because a lit pitch under white
type is a legibility problem: the photo is desaturated and held back to 62%
opacity, drifting on the same slow ken-burns the player panels use, under a
two-part scrim — a vertical wash that goes heaviest at the top and bottom where
the small type sits, and a vignette pulling the eye to the middle. The type also
carries a shadow, so swapping in a brighter or busier photo doesn't undo it.

Tuning, if yours needs different treatment: `backgroundPosition` (currently
`50% 42%`, which keeps the horizon off the headline), the `opacity` and `filter`
on the photo layer, and the two gradient stops below it.

Around 1600px wide and under ~300kB is plenty — it is the first thing anyone
loads, and it sits behind a scrim that hides fine detail anyway.

**It's a photograph, so somebody owns it.** Use one you shot, one you've
licensed, or one under terms that permit this.

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
