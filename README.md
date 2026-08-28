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
```

`npm run dev` serves the game but not `/api/photo`, so portraits fall back to
the monogram. Use `vercel dev` if you want the photo lookup locally.

## How it's put together

```
index.html
api/photo.js        serverless photo lookup (Vercel function)
src/App.jsx         the whole game — data, audio engine, UI
src/main.jsx        mount
src/styles.css      the ~50 utility classes the app uses, hand-written
```

There's no CSS framework and no state library. `styles.css` covers exactly the
utilities `App.jsx` references, which keeps the build to Vite and React alone.

### Player data

`SQUAD` in `src/App.jsx` is a flat array of
`(name, club, position, age, flag, value)`. Values are rounded estimates in
millions of euros, not official figures — they're calibrated for a fun guessing
curve, not for accuracy. Swapping in a live feed means replacing that one array.

`KIT` maps each club to the two-stop gradient its panel is painted with. Add a
club to `SQUAD` and add it to `KIT` too, or the panel falls back to grey.

### Photos

`api/photo.js` asks Wikipedia for a player's lead image and returns the URL.
The browser never calls Wikipedia directly, so there are no cross-origin rules
to depend on, and the edge cache means one lookup per player serves everybody.
Article titles default to the player's name, with a short override map in
`WIKI_TITLE` for the ambiguous ones (Rodri, Gavi, Vitinha, Ederson, Alisson,
Endrick, Kim Min-jae).

Any lookup that misses falls through to the oversized shirt-back initials, so a
bad title or a dead network degrades quietly instead of breaking a round.

**Before this takes real traffic:** Wikipedia images are mostly CC BY-SA, which
requires per-image attribution rather than the single line on the intro screen.
`api/photo.js` already returns a `credit` URL — surface it, or self-host a set
of images you've cleared and cropped consistently.

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
