import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Play,
  Check,
  X,
  Flame,
  Volume2,
  VolumeX,
} from "lucide-react";

import { KIT, SQUAD } from "./data/squad.js";

/* ------------------------------------------------------------------ */

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Avoid identical neighbours so no round is a coin-flip on a tie. */
function buildDeck() {
  const a = shuffle(SQUAD);
  for (let i = 1; i < a.length; i++) {
    if (a[i].value === a[i - 1].value) {
      for (let j = i + 2; j < a.length; j++) {
        if (a[j].value !== a[i - 1].value && a[j].value !== (a[i + 1] || {}).value) {
          [a[i], a[j]] = [a[j], a[i]];
          break;
        }
      }
    }
  }
  return a;
}

const initials = (n) =>
  n.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");

const DISPLAY =
  '"Haettenschweiler","Arial Narrow","Oswald","Impact","Anton",system-ui,sans-serif';
const BODY = '"Inter","Helvetica Neue",Helvetica,Arial,system-ui,sans-serif';
const LED = '"SF Mono",ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';

/* Landing backdrop. Dropped in at public/landing.jpg, so it is served from
 * our own origin like everything else. Absent, the CSS below simply paints
 * nothing over the gradient and the intro looks as it always did — the
 * screen never depends on the file being there. */
const LANDING_IMAGE = "/landing.jpg";

/* ------------------------------------------------------------------ *
 *  SOUND
 *
 *  Three recordings do the heavy lifting — the crowd bed, the goal, and
 *  the kick on each call. Everything else is still synthesised: the
 *  ticker blips, the full-time whistle, the transition whoosh.
 *
 *  Samples play through the same master gain as the synth voices, so one
 *  mute switch covers both. And every one of them falls back to the
 *  synthesised version it replaced if the file is slow, missing, or the
 *  browser refuses to decode it — the game should never go quiet because
 *  of a 404.
 * ------------------------------------------------------------------ */

const SOUNDS = {
  goal: "/sounds/goals.mp3",
  kick: "/sounds/soccer-kick.mp3",
  crowd: "/sounds/fangesang.mp3",
};

/* Levels are the one thing here that has to be judged by ear. They live
 * together so they can be tuned in one place. */
const LEVEL = { goal: 0.85, kick: 0.7, crowd: 0.34 };

/* Seconds between the kick-off strike and the cheer behind it. Measured
 * against the two files rather than guessed: the impact is at 0.05s and
 * has decayed by 0.1s, and the cheer needs 0.3s to build. */
const KICKOFF_CHEER = 0.22;

/* Bytes are fetched independently of the AudioContext, which cannot exist
 * until the first tap. Starting the fetch on mount means the file is
 * usually in the browser cache by the time Kick off is pressed. */
const rawAudio = new Map();
function prefetchSound(url) {
  if (!rawAudio.has(url)) {
    rawAudio.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
    );
  }
  return rawAudio.get(url);
}
function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const resume = () => {
    if (ctx.state === "suspended") ctx.resume();
  };

  function burst({ freq = 700, q = 0.8, dur = 1.2, peak = 0.25, attack = 0.08, type = "bandpass" }) {
    resume();
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.05);
    return { f, t };
  }

  function tone(freq, { dur = 0.25, peak = 0.16, type = "triangle", delay = 0, glide = null } = {}) {
    resume();
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(master);
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* one blast of a pea whistle — trilled twin squares plus breath noise */
  function blast(delay, dur, gain = 0.09) {
    resume();
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(2080, t);
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.setValueAtTime(2610, t);
    const trill = ctx.createOscillator();
    trill.frequency.value = 34;
    const td = ctx.createGain();
    td.gain.value = 110;
    trill.connect(td);
    td.connect(o.frequency);
    td.connect(o2.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    const g2 = ctx.createGain();
    g2.gain.value = 0.0001;
    o.connect(g);
    o2.connect(g2);
    g.connect(master);
    g2.connect(master);
    [
      [g, gain],
      [g2, gain * 0.55],
    ].forEach(([node, peak]) => {
      node.gain.linearRampToValueAtTime(peak, t + 0.03);
      node.gain.setValueAtTime(peak, t + dur - 0.05);
      node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 3200;
    nf.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = 0.0001;
    n.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    ng.gain.linearRampToValueAtTime(gain * 0.32, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    [o, o2, trill, n].forEach((node) => {
      node.start(t);
      node.stop(t + dur + 0.05);
    });
  }

  /* scattered applause — short filtered noise clicks at random offsets */
  function claps(delay, span, count, peak = 0.05) {
    resume();
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + delay + Math.random() * span;
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.playbackRate.value = 0.9 + Math.random() * 0.5;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1400 + Math.random() * 1900;
      f.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      n.connect(f);
      f.connect(g);
      g.connect(master);
      g.gain.linearRampToValueAtTime(peak * (0.5 + Math.random()), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.start(t, Math.random() * 1.5);
      n.stop(t + 0.12);
    }
  }

  /* The synthesised goal: ball thud, net snap, ripple, then a
   * filter-opening roar with applause and a detuned horn. Superseded by
   * goals.mp3 and kept as its fallback. */
  function synthGoal() {
    tone(150, { dur: 0.2, peak: 0.3, type: "sine", glide: 55 });
    const snap = burst({ freq: 2600, q: 1.1, dur: 0.24, peak: 0.16, attack: 0.005 });
    snap.f.frequency.setValueAtTime(3200, snap.t);
    snap.f.frequency.linearRampToValueAtTime(1400, snap.t + 0.22);
    claps(0.06, 0.2, 5, 0.03);

    const roar = burst({ freq: 700, q: 0.4, dur: 2.9, peak: 0.42, attack: 0.42 });
    roar.f.frequency.setValueAtTime(430, roar.t);
    roar.f.frequency.linearRampToValueAtTime(1900, roar.t + 0.95);
    claps(0.35, 1.9, 38, 0.05);

    /* stadium horn under the roar */
    tone(330, { dur: 1.1, peak: 0.05, type: "sawtooth", delay: 0.28 });
    tone(332.5, { dur: 1.1, peak: 0.05, type: "sawtooth", delay: 0.28 });
  }

  /* Named rather than a method: the guess handler picks between correct
   * and wrong as `(ok ? a.correct : a.wrong)()`, which drops the
   * receiver, so nothing here may depend on `this`. */
  function cheer(when = 0) {
    resume();
    playSample(SOUNDS.goal, { gain: LEVEL.goal, when })
      .ready()
      .then((ok) => {
        if (!ok) setTimeout(synthGoal, when * 1000);
      });
  }

  /* The struck ball. Named for the same reason cheer is. */
  function strike() {
    resume();
    playSample(SOUNDS.kick, { gain: LEVEL.kick })
      .ready()
      .then((ok) => {
        if (!ok) tone(160, { dur: 0.16, peak: 0.22, type: "sine", glide: 60 });
      });
  }

  let bed = null;
  let swellTimer = null;

  /* The synthesised stand: broadband roar, chatter, waves of cheering.
   * No longer the default — it is what plays if fangesang.mp3 does not
   * arrive, so a missing file costs fidelity rather than silence. */
  function synthBed(on) {
    if (on && !bed) {
      resume();
      const nodes = [];
      const mk = (type, freq, q, level, lfoRate, lfoDepth) => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoRate;
        const lg = ctx.createGain();
        lg.gain.value = lfoDepth;
        lfo.connect(lg);
        lg.connect(g.gain);
        src.connect(f);
        f.connect(g);
        g.connect(master);
        g.gain.setTargetAtTime(level, ctx.currentTime, 1.4);
        src.start();
        lfo.start();
        nodes.push(src, lfo);
        return g;
      };
      const body = mk("bandpass", 620, 0.35, 0.075, 0.11, 0.03);
      mk("highpass", 2400, 0.5, 0.022, 0.07, 0.009);
      mk("lowpass", 260, 0.4, 0.03, 0.05, 0.012);

      /* every few seconds the crowd surges, the way a real stand does */
      const surge = () => {
        const t = ctx.currentTime;
        body.gain.cancelScheduledValues(t);
        body.gain.setTargetAtTime(0.16, t, 0.8);
        body.gain.setTargetAtTime(0.075, t + 2.2, 1.6);
        claps(0.4, 2.2, 10, 0.022);
        swellTimer = setTimeout(surge, 6000 + Math.random() * 7000);
      };
      swellTimer = setTimeout(surge, 4000 + Math.random() * 4000);

      bed = { nodes, body };
    } else if (!on && bed) {
      const b = bed;
      bed = null;
      clearTimeout(swellTimer);
      swellTimer = null;
      b.body.gain.cancelScheduledValues(ctx.currentTime);
      b.body.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      setTimeout(() => {
        b.nodes.forEach((n) => {
          try {
            n.stop();
          } catch (e) {
            /* already stopped */
          }
        });
      }, 1400);
    }
  }

  /* Decoded samples, keyed by url. decodeAudioData detaches the buffer it
   * is given, so each decode gets its own copy of the bytes. */
  const decoded = new Map();
  function sample(url) {
    if (!decoded.has(url)) {
      decoded.set(
        url,
        prefetchSound(url)
          .then((bytes) => (bytes ? ctx.decodeAudioData(bytes.slice(0)) : null))
          .catch(() => null)
      );
    }
    return decoded.get(url);
  }

  /* Returns the source node so a loop can be stopped later, or null when
   * the sample is not ready — which is the caller's cue to fall back. */
  function playSample(url, { gain = 1, loop = false, when = 0 } = {}) {
    const pending = sample(url);
    let node = null;
    let stopped = false;

    pending.then((buf) => {
      if (!buf || stopped) return;
      resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(master);
      /* Scheduled on the audio clock rather than a timer, so a delayed
       * cue lands where it was meant to even under a busy main thread. */
      src.start(when ? ctx.currentTime + when : undefined);
      node = { src, g };
    });

    return {
      /* Fade rather than cut: stopping an 18-second crowd loop dead is
       * audible in a way stopping a 2-second cheer is not. */
      stop(fade = 0.6) {
        stopped = true;
        if (!node) return;
        const { src, g } = node;
        node = null;
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        setTimeout(() => {
          try {
            src.stop();
          } catch (e) {
            /* already stopped */
          }
        }, fade * 1000 + 200);
      },
      /* Whether the sample was there in time; false means fall back. */
      ready: () => pending.then((b) => !!b),
    };
  }

  let crowd = null;

  return {
    setMuted(m) {
      master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
    },
    /* The stand. A recording when it is available, the synth bed when it
     * is not — decided once the fetch settles, so a slow network degrades
     * instead of stalling. */
    ambient(on) {
      if (on) {
        if (crowd) return;
        const handle = playSample(SOUNDS.crowd, { gain: LEVEL.crowd, loop: true });
        crowd = handle;
        handle.ready().then((ok) => {
          if (!ok && crowd === handle) synthBed(true);
        });
      } else {
        if (crowd) {
          crowd.stop(0.9);
          crowd = null;
        }
        synthBed(false);
      }
    },
    /* kick off — one sharp blast */
    whistle() {
      blast(0, 0.34, 0.1);
    },
    /* one blip per digit change, pitch climbing with the ticker */
    tick(p) {
      tone(520 + p * 880, { dur: 0.045, peak: 0.04, type: "square" });
    },
    /* GOAL. The recording when it is loaded, the synthesised cheer when
     * it is not — the same fallback the crowd bed gets. */
    correct: cheer,
    /* The call itself — a struck ball under MORE / LESS. */
    kick: strike,
    /* Kick off: the strike, then the crowd behind it.
     *
     * The delay is short on purpose. soccer-kick.mp3 is a 0.1s impact
     * followed by 0.7s of near-silence, and goals.mp3 spends its first
     * 0.3s building, so starting the cheer when the kick file *ends*
     * leaves an audible hole. Coming in just after the impact decays
     * reads as one event: struck, then the ground goes up. */
    kickoff() {
      strike();
      cheer(KICKOFF_CHEER);
    },
    /* FULL TIME — three blasts, and the crowd falls away */
    wrong() {
      blast(0, 0.28, 0.1);
      blast(0.42, 0.28, 0.1);
      blast(0.84, 0.85, 0.11);
      const b = burst({ freq: 400, q: 0.5, dur: 2.4, peak: 0.15, attack: 0.1, type: "lowpass" });
      b.f.frequency.setValueAtTime(900, b.t);
      b.f.frequency.linearRampToValueAtTime(170, b.t + 2);
    },
    whoosh() {
      const b = burst({ freq: 400, q: 1.3, dur: 0.6, peak: 0.11, attack: 0.16 });
      b.f.frequency.setValueAtTime(300, b.t);
      b.f.frequency.linearRampToValueAtTime(2200, b.t + 0.55);
    },
    close() {
      try {
        ctx.close();
      } catch (e) {
        /* noop */
      }
    },
  };
}


/* ------------------------------------------------------------------ */

function Panel({ player, reveal, shown, dim, photo }) {
  const [c1, c2] = KIT[player.club] || ["#334155", "#0A0A0A"];
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [photo]);

  return (
    <div
      className="relative overflow-hidden"
      style={{ flex: "0 0 33.3333%", background: `linear-gradient(150deg, ${c1} 0%, ${c2} 78%)` }}
    >
      {/* The portrait carries the round, so it is the one layer that gets
          to be legible. It used to blend in luminosity, which takes its
          luminance and the backdrop's hue — a technically pretty effect
          that painted every player the colour of his kit gradient and lost
          the face with it. Now it is composited normally and the club
          colour arrives as its own tint above, where it can be dialled
          back without touching detail. */}
      {photo && (
        <img
          src={photo}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
          className="absolute pointer-events-none select-none"
          style={{
            top: "-6%",
            left: "-6%",
            width: "112%",
            height: "112%",
            objectFit: "cover",
            objectPosition: "50% 18%",
            opacity: loaded ? 0.95 : 0,
            filter: "contrast(1.04) saturate(0.95)",
            transition: "opacity 600ms ease",
            animation: loaded ? "kenburns 18s ease-in-out infinite alternate" : "none",
          }}
        />
      )}

      {/* Club colour, washed over the photo rather than through it, and
          masked away from the middle. These portraits are cut-outs on a
          plain studio grey, so the mask puts the colour exactly where it
          reads as lighting — the empty backdrop and the edges — and keeps
          it off the face, which is the part worth seeing. */}
      {photo && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(150deg, ${c1} 0%, ${c2} 78%)`,
            opacity: 0.62,
            maskImage:
              "radial-gradient(56% 40% at 50% 34%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.45) 58%, #000 88%)",
            WebkitMaskImage:
              "radial-gradient(56% 40% at 50% 34%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.45) 58%, #000 88%)",
          }}
        />
      )}

      {/* floodlight sweep */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,0.13), transparent 60%)",
        }}
      />
      {/* LED wall dot texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.09,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "5px 5px",
        }}
      />

      {/* Stadium shadow, now weighted rather than even: light across the
          top third where the face is, heavy from the middle down where the
          name, club and value have to stay readable. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.22) 26%, rgba(0,0,0,0.58) 58%, rgba(0,0,0,0.88) 100%)",
        }}
      />
      {/* oversized shirt-back initials — the fallback when no photo loads */}
      {!photo && (
        <div
          className="absolute select-none pointer-events-none"
          style={{
            right: "-2%",
            bottom: "-14%",
            fontFamily: DISPLAY,
            fontSize: "clamp(120px, 34vw, 300px)",
            lineHeight: 0.78,
            letterSpacing: "-0.04em",
            color: "rgba(255,255,255,0.10)",
            textTransform: "uppercase",
          }}
        >
          {initials(player.name)}
        </div>
      )}

      <div
        className={`relative h-full w-full flex flex-col items-center justify-center px-5 text-center ${
          dim ? "opacity-70" : ""
        }`}
        /* The photo is far more present than it was, so the type carries
           its own shadow rather than relying on the scrim alone. */
        style={{
          transition: "opacity 300ms",
          textShadow: "0 2px 16px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.8)",
        }}
      >
        <div
          className="flex items-center gap-2 mb-3"
          style={{ fontFamily: BODY, fontSize: 11, letterSpacing: "0.22em" }}
        >
          <span className="text-2xl leading-none">{player.flag}</span>
          <span className="text-white uppercase" style={{ opacity: 0.75 }}>
            {player.pos} · {player.age}
          </span>
        </div>

        <h2
          className="text-white uppercase"
          style={{
            fontFamily: DISPLAY,
            fontSize: "clamp(30px, 8vw, 62px)",
            lineHeight: 0.92,
            letterSpacing: "0.01em",
            textShadow: "0 6px 26px rgba(0,0,0,0.55)",
            maxWidth: "14ch",
          }}
        >
          {player.name}
        </h2>

        <div
          className="mt-2 mb-4 text-white uppercase"
          style={{ fontFamily: BODY, fontSize: 12, letterSpacing: "0.3em", opacity: 0.8 }}
        >
          {player.club}
        </div>

        <div className="min-h-[92px] flex items-center justify-center w-full">
          {shown ? (
            <div className="flex flex-col items-center">
              <div
                className="uppercase mb-1"
                style={{
                  fontFamily: BODY,
                  fontSize: 10,
                  letterSpacing: "0.34em",
                  color: "#F5A524",
                }}
              >
                Market value
              </div>
              <div
                className="flex items-baseline"
                style={{
                  fontFamily: LED,
                  color: "#FFD98A",
                  textShadow: "0 0 18px rgba(245,165,36,0.55)",
                }}
              >
                <span style={{ fontSize: "clamp(24px,6vw,36px)", opacity: 0.8 }}>€</span>
                <span
                  style={{
                    fontSize: "clamp(42px,11vw,72px)",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {reveal.toFixed(1)}
                </span>
                <span style={{ fontSize: "clamp(20px,5vw,30px)", opacity: 0.8 }}>m</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function App() {
  const [screen, setScreen] = useState("intro"); // intro | play | over
  const [deck, setDeck] = useState(() => buildDeck());
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("guess"); // guess | reveal | verdict | shift
  const [pick, setPick] = useState(null);
  const [right, setRight] = useState(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [ticker, setTicker] = useState(0);
  const [shifted, setShifted] = useState(false);
  const [instant, setInstant] = useState(false);
  const [wide, setWide] = useState(false);
  const [muted, setMuted] = useState(false);
  const timers = useRef([]);
  const audio = useRef(null);

  const sfx = useCallback(() => {
    if (!audio.current) audio.current = createAudio();
    return audio.current;
  }, []);

  useEffect(() => {
    if (audio.current) audio.current.setMuted(muted);
  }, [muted]);

  useEffect(
    () => () => {
      if (audio.current) {
        audio.current.ambient(false);
        audio.current.close();
      }
    },
    []
  );

  const after = useCallback((ms, fn) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* Pull the audio down early. The AudioContext cannot exist before the
   * first tap, but the bytes can already be in cache by then. */
  useEffect(() => {
    for (const url of Object.values(SOUNDS)) prefetchSound(url);
  }, []);

  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 880);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const trio = [deck[idx], deck[idx + 1], deck[idx + 2] || deck[0]];
  const known = trio[0];
  const mystery = trio[1];

  const start = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setDeck(buildDeck());
    setIdx(0);
    setScore(0);
    setPick(null);
    setRight(null);
    setTicker(0);
    setShifted(false);
    setInstant(false);
    setPhase("guess");
    setScreen("play");

    const a = sfx();
    if (a) {
      a.setMuted(muted);
      a.kickoff();
      a.ambient(true);
    }
  };

  const guess = (dir) => {
    if (phase !== "guess") return;
    setPick(dir);
    setPhase("reveal");

    const a = sfx();
    if (a) a.kick();
    const target = mystery.value;
    const t0 = performance.now();
    const DUR = 950;
    let lastBlip = -1;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = target * eased;
      setTicker(v);
      if (a && Math.floor(v) !== lastBlip) {
        lastBlip = Math.floor(v);
        a.tick(p);
      }
      if (p < 1) requestAnimationFrame(step);
      else {
        const ok = dir === "higher" ? target >= known.value : target <= known.value;
        setRight(ok);
        setPhase("verdict");
        if (a) (ok ? a.correct : a.wrong)();
        if (ok) {
          setScore((s) => {
            const n = s + 1;
            setBest((b) => Math.max(b, n));
            return n;
          });
          after(1150, () => {
            setPhase("shift");
            setShifted(true);
            if (a) a.whoosh();
            after(760, () => {
              setInstant(true);
              setShifted(false);
              setIdx((i) => {
                const next = i + 1;
                if (next + 3 >= deck.length) setDeck((d) => [...d, ...buildDeck()]);
                return next;
              });
              setPick(null);
              setRight(null);
              setTicker(0);
              setPhase("guess");
              requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
            });
          });
        } else {
          after(1500, () => {
            if (a) a.ambient(false);
            setScreen("over");
          });
        }
      }
    };
    requestAnimationFrame(step);
  };

  const axis = wide ? "X" : "Y";
  const trackStyle = {
    display: "flex",
    flexDirection: wide ? "row" : "column",
    width: wide ? "150%" : "100%",
    height: wide ? "100%" : "150%",
    transform: `translate${axis}(${shifted ? "-33.3333%" : "0%"})`,
    transition: instant ? "none" : "transform 760ms cubic-bezier(0.76,0,0.24,1)",
  };

  const revealed = phase !== "guess";

  return (
    <div
      className="relative w-full flex flex-col overflow-hidden"
      style={{ height: "100dvh", background: "#05070D", fontFamily: BODY }}
    >
      <style>{`
        @keyframes bootIn { from { opacity:0; transform: translateY(18px) } to { opacity:1; transform:none } }
        @keyframes badgePop { 0%{transform:translate(-50%,-50%) scale(.4);opacity:0}
          60%{transform:translate(-50%,-50%) scale(1.14);opacity:1}
          100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
        @keyframes flash { from { opacity:.55 } to { opacity:0 } }
        @keyframes scan { from { transform: translateY(-100%) } to { transform: translateY(200%) } }
        @keyframes hum { 0%,100%{opacity:.5} 50%{opacity:.85} }
        @keyframes nudge { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes kenburns { from { transform: scale(1) translate(0,0) } to { transform: scale(1.09) translate(-1.5%, -1.5%) } }
        .btn-vs { transition: transform 160ms ease, background 160ms ease, border-color 160ms ease; }
        .btn-vs:hover { transform: scale(1.05); }
        .btn-vs:active { transform: scale(.96); }
        .btn-vs:focus-visible { outline: 3px solid #F5A524; outline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
        }
      `}</style>

      {/* ---------------- scoreboard rail ---------------- */}
      <header
        className="relative z-40 flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#05070D" }}
      >
        <div className="flex items-center gap-2">
          <div style={{ width: 9, height: 9, background: "#F5A524", borderRadius: 2 }} />
          <span
            className="uppercase text-white"
            style={{ fontFamily: DISPLAY, fontSize: 17, letterSpacing: "0.08em" }}
          >
            Market Value
          </span>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div
              className="uppercase"
              style={{ fontSize: 9, letterSpacing: "0.28em", color: "rgba(255,255,255,0.45)" }}
            >
              Streak
            </div>
            <div
              className="flex items-center justify-end gap-1"
              style={{ fontFamily: LED, fontSize: 19, color: "#fff", fontWeight: 700 }}
            >
              {score >= 5 && <Flame size={14} color="#F5A524" />}
              {score}
            </div>
          </div>
          <div className="text-right">
            <div
              className="uppercase"
              style={{ fontSize: 9, letterSpacing: "0.28em", color: "rgba(255,255,255,0.45)" }}
            >
              Best
            </div>
            <div style={{ fontFamily: LED, fontSize: 19, color: "#F5A524", fontWeight: 700 }}>
              {best}
            </div>
          </div>
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            className="btn-vs flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: 2,
              color: muted ? "rgba(255,255,255,0.4)" : "#F5A524",
            }}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
        </div>
      </header>

      {/* ---------------- pitch ---------------- */}
      <main className="relative flex-1 overflow-hidden">
        <div style={trackStyle}>
          <Panel
            player={trio[0]}
            reveal={known.value}
            shown
            dim={phase === "shift"}
            photo={trio[0].photo}
          />
          <Panel
            player={trio[1]}
            reveal={phase === "reveal" ? ticker : mystery.value}
            shown={revealed}
            photo={trio[1].photo}
          />
          <Panel player={trio[2]} reveal={0} shown={false} photo={trio[2].photo} />
        </div>

        {/* halfway line */}
        <div
          className="absolute z-20 pointer-events-none"
          style={
            wide
              ? { left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.22)" }
              : { top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.22)" }
          }
        />

        {/* centre badge */}
        <div
          className="absolute z-30 flex items-center justify-center"
          style={{
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            width: 62,
            height: 62,
            borderRadius: "50%",
            background: "#05070D",
            border: `2px solid ${
              phase === "verdict" ? (right ? "#17C964" : "#FF4D4D") : "rgba(255,255,255,0.3)"
            }`,
            boxShadow:
              phase === "verdict"
                ? `0 0 34px ${right ? "rgba(23,201,100,.6)" : "rgba(255,77,77,.6)"}`
                : "0 0 24px rgba(0,0,0,.7)",
            animation: phase === "verdict" ? "badgePop 420ms cubic-bezier(.2,1.4,.4,1)" : "none",
          }}
        >
          {phase === "verdict" ? (
            right ? (
              <Check size={30} color="#17C964" strokeWidth={3} />
            ) : (
              <X size={30} color="#FF4D4D" strokeWidth={3} />
            )
          ) : (
            <span
              className="uppercase text-white"
              style={{ fontFamily: DISPLAY, fontSize: 17, letterSpacing: "0.05em" }}
            >
              vs
            </span>
          )}
        </div>

        {/* prompt + controls */}
        {phase === "guess" && (
          <div
            className="absolute z-30 left-0 right-0 flex flex-col items-center gap-3 px-4"
            style={{
              top: "auto",
              bottom: wide ? 40 : 30,
              animation: "bootIn 420ms ease both",
            }}
          >
            <p
              className="uppercase text-center"
              style={{
                fontSize: 10,
                letterSpacing: "0.3em",
                color: "rgba(255,255,255,0.6)",
              }}
            >
              Worth more or less than {known.name.split(" ").slice(-1)[0]}?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => guess("higher")}
                className="btn-vs flex items-center gap-2 px-6 py-3 uppercase"
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 19,
                  letterSpacing: "0.08em",
                  color: "#05070D",
                  background: "#F5A524",
                  border: "2px solid #F5A524",
                  borderRadius: 2,
                }}
              >
                <ArrowUp size={18} strokeWidth={3} /> More
              </button>
              <button
                onClick={() => guess("lower")}
                className="btn-vs flex items-center gap-2 px-6 py-3 uppercase"
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 19,
                  letterSpacing: "0.08em",
                  color: "#fff",
                  background: "transparent",
                  border: "2px solid rgba(255,255,255,0.55)",
                  borderRadius: 2,
                }}
              >
                <ArrowDown size={18} strokeWidth={3} /> Less
              </button>
            </div>
          </div>
        )}

        {/* your call, held on screen during the reveal */}
        {revealed && phase !== "shift" && (
          <div
            className="absolute z-30 left-1/2 flex items-center gap-2 px-3 py-1"
            style={{
              top: "auto",
              bottom: wide ? 28 : 34,
              transform: "translateX(-50%)",
              background: "rgba(5,7,13,0.85)",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 2,
            }}
          >
            {pick === "higher" ? (
              <ArrowUp size={13} color="#F5A524" strokeWidth={3} />
            ) : (
              <ArrowDown size={13} color="#F5A524" strokeWidth={3} />
            )}
            <span
              className="uppercase"
              style={{ fontSize: 9, letterSpacing: "0.28em", color: "rgba(255,255,255,0.75)" }}
            >
              You said {pick === "higher" ? "more" : "less"}
            </span>
          </div>
        )}

        {/* scan sweep while the value spins up */}
        {phase === "reveal" && (
          <div
            className="absolute inset-0 z-20 pointer-events-none overflow-hidden"
            style={{ opacity: 0.5 }}
          >
            <div
              style={{
                height: "45%",
                background:
                  "linear-gradient(180deg, transparent, rgba(245,165,36,0.14), transparent)",
                animation: "scan 950ms linear",
              }}
            />
          </div>
        )}

        {/* verdict flash */}
        {phase === "verdict" && (
          <div
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
              background: right ? "#17C964" : "#FF4D4D",
              animation: "flash 620ms ease-out forwards",
            }}
          />
        )}
      </main>

      {/* ---------------- intro ---------------- */}
      {screen === "intro" && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center px-7 text-center overflow-hidden"
          style={{
            background:
              "radial-gradient(90% 60% at 50% 20%, #14203A 0%, #05070D 70%)",
          }}
        >
          {/* Match photo, treated like the player panels rather than dropped
              in raw: desaturated, held well back, and drifting slowly so the
              screen has some life before kick off. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${LANDING_IMAGE})`,
              backgroundSize: "cover",
              backgroundPosition: "50% 42%",
              filter: "saturate(0.62) contrast(1.04) brightness(0.88)",
              opacity: 0.62,
              animation: "kenburns 26s ease-in-out infinite alternate",
            }}
          />

          {/* Scrim. The photo is a bright green pitch under floodlights and
              the copy is thin white type, so legibility has to be bought
              back deliberately: a dark wash, heavier top and bottom, plus a
              vignette to pull the eye into the middle. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, rgba(5,7,13,0.72) 0%, rgba(5,7,13,0.34) 30%, rgba(5,7,13,0.40) 60%, rgba(5,7,13,0.88) 100%)",
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(75% 60% at 50% 42%, rgba(5,7,13,0) 0%, rgba(5,7,13,0.34) 72%, rgba(5,7,13,0.70) 100%)",
            }}
          />

          {/* The scrim is tuned for this photo, but a shadow on the type
              means legibility survives swapping in a brighter or busier one. */}
          <div
            className="relative"
            style={{
              animation: "bootIn 520ms ease both",
              textShadow: "0 2px 20px rgba(5,7,13,0.9), 0 1px 3px rgba(5,7,13,0.75)",
            }}
          >
            <div
              className="uppercase mb-3"
              style={{ fontSize: 10, letterSpacing: "0.42em", color: "#F5A524" }}
            >
              Transfer desk
            </div>
            <h1
              className="uppercase text-white"
              style={{
                fontFamily: DISPLAY,
                fontSize: "clamp(52px, 17vw, 120px)",
                lineHeight: 0.82,
                letterSpacing: "0.005em",
              }}
            >
              More
              <br />
              <span style={{ color: "#F5A524" }}>or Less</span>
            </h1>
            <p
              className="mt-5 mx-auto"
              style={{
                maxWidth: 300,
                fontSize: 14,
                lineHeight: 1.6,
                color: "rgba(255,255,255,0.78)",
              }}
            >
              One player's market value is on the board. Call whether the next one is
              worth more or less. Miss once and the window shuts.
            </p>
            <button
              onClick={start}
              className="btn-vs mt-8 inline-flex items-center gap-2 px-9 py-4 uppercase"
              style={{
                fontFamily: DISPLAY,
                fontSize: 22,
                letterSpacing: "0.08em",
                color: "#05070D",
                background: "#F5A524",
                border: "2px solid #F5A524",
                borderRadius: 2,
                animation: "nudge 2.4s ease-in-out infinite",
              }}
            >
              <Play size={18} strokeWidth={3} fill="#05070D" /> Kick off
            </button>
            <p
              className="mt-7 uppercase"
              style={{ fontSize: 9, letterSpacing: "0.24em", color: "rgba(255,255,255,0.44)" }}
            >
              Squads &amp; photos via API-Football · values via Transfermarkt
            </p>
          </div>
        </div>
      )}

      {/* ---------------- full time ---------------- */}
      {screen === "over" && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center px-7 text-center"
          style={{ background: "rgba(5,7,13,0.94)", animation: "bootIn 380ms ease both" }}
        >
          <div
            className="uppercase mb-2"
            style={{ fontSize: 10, letterSpacing: "0.42em", color: "#FF4D4D" }}
          >
            Full time
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: "clamp(88px, 30vw, 190px)",
              lineHeight: 0.8,
              color: "#fff",
            }}
          >
            {score}
          </div>
          <div
            className="uppercase mb-6"
            style={{ fontSize: 11, letterSpacing: "0.34em", color: "rgba(255,255,255,0.6)" }}
          >
            correct calls · best {best}
          </div>

          <div
            className="w-full mb-8"
            style={{ maxWidth: 380, borderTop: "1px solid rgba(255,255,255,0.12)" }}
          >
            {[known, mystery].map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}
              >
                <div className="text-left">
                  <div
                    className="uppercase text-white"
                    style={{ fontFamily: DISPLAY, fontSize: 19, letterSpacing: "0.02em" }}
                  >
                    {p.flag} {p.name}
                  </div>
                  <div
                    className="uppercase"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.24em",
                      color: "rgba(255,255,255,0.45)",
                    }}
                  >
                    {p.club}
                  </div>
                </div>
                <div style={{ fontFamily: LED, fontSize: 20, color: "#F5A524", fontWeight: 700 }}>
                  €{p.value.toFixed(1)}m
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={start}
            className="btn-vs inline-flex items-center gap-2 px-9 py-4 uppercase"
            style={{
              fontFamily: DISPLAY,
              fontSize: 22,
              letterSpacing: "0.08em",
              color: "#05070D",
              background: "#F5A524",
              border: "2px solid #F5A524",
              borderRadius: 2,
            }}
          >
            <RotateCcw size={18} strokeWidth={3} /> Play again
          </button>
        </div>
      )}
    </div>
  );
}
