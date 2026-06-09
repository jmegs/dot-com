/**
 * Chroma — chromatic glowing orbs (ported from agent-id-workshop "chroma" direction).
 *
 * Vivid, saturated radial-gradient orbs composited with `screen` (dark bg) or
 * `multiply` (light bg) blending so overlaps glow / bloom. A two-octave simplex
 * film-grain overlay adds risograph texture. Orbs drift along simplex noise paths.
 *
 * Everything is deterministic from a single seed UUID. Two independent PRNG
 * streams are used (matching the workshop exactly):
 *   - palette stream:  mulberry32(seed ^ 0xdeadbeef)
 *   - render stream:   mulberry32(seed)  +  noise from mulberry32(seed + 1)
 */

import { createNoise2D } from "simplex-noise";

// chroma schema defaults
const ORB_COUNT = 5;
const ORB_RADIUS = 0.45;
const GLOW_SOFTNESS = 2.5;
const GRAIN_AMOUNT = 0.22;
const HARMONY: HarmonyMode = "auto";

const AMBIENT_SPEED = 0.008;
const GRAIN_RES = 128;
const TAU = Math.PI * 2;

export type Appearance = "light" | "dark";

// ── PRNG (prng.ts) ────────────────────────────────────────────────────────────
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Strip dashes, hash the hex string -> 32-bit seed. Single source of determinism. */
function seedFromUuid(uuid: string): number {
  const hex = uuid.replace(/-/g, "");
  const hasher = xmur3(hex);
  hasher(); // call twice for better mixing
  return (hasher() * 4294967296) >>> 0;
}

// ── Color helpers (geom.ts / oklch.ts) ───────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function isLightHex(hex: string): boolean {
  return relativeLuminance(hex) > 0.179;
}

function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * c ** (1 / 2.4) - 0.055;
}

function oklchToHex(L: number, C: number, H: number): string {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const r = Math.round(Math.max(0, Math.min(1, linearToSrgb(rLin))) * 255);
  const g = Math.round(Math.max(0, Math.min(1, linearToSrgb(gLin))) * 255);
  const bv = Math.round(Math.max(0, Math.min(1, linearToSrgb(bLin))) * 255);

  return "#" + [r, g, bv].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ── Palette (palette.ts) ──────────────────────────────────────────────────────
type HarmonyMode =
  | "auto"
  | "analogous"
  | "complementary"
  | "split"
  | "triadic"
  | "tetradic";

const NAMED_HARMONIES: Exclude<HarmonyMode, "auto">[] = [
  "analogous",
  "complementary",
  "split",
  "triadic",
  "tetradic",
];

type Palette = { name: string; colors: string[] };

/** Build a 5-color palette from the RNG stream (OKLCH). See workshop palette.ts. */
function generatePalette(
  rng: () => number,
  harmony: HarmonyMode,
  appearance: Appearance,
): Palette {
  const mode =
    harmony === "auto"
      ? NAMED_HARMONIES[Math.floor(rng() * NAMED_HARMONIES.length)]
      : harmony;

  const h = rng() * 360;

  const light = appearance === "light";
  const Lbg = light ? 0.93 + rng() * 0.04 : 0.08 + rng() * 0.06;
  const Cbg = 0.01 + rng() * 0.02;
  const Ldark = light ? 0.62 + rng() * 0.12 : 0.2 + rng() * 0.12;
  const Cdark = 0.04 + rng() * 0.08;
  const Lmid = light ? 0.46 + rng() * 0.12 : 0.5 + rng() * 0.14;
  const Cmid = 0.13 + rng() * 0.09;
  const Lharm = light ? 0.4 + rng() * 0.12 : 0.42 + rng() * 0.14;
  const Charm = 0.1 + rng() * 0.1;
  const Llight = light ? 0.16 + rng() * 0.12 : 0.72 + rng() * 0.16;
  const Clight = 0.03 + rng() * 0.07;

  let h1 = h,
    h2 = h,
    h3 = h;
  switch (mode) {
    case "analogous":
      h1 = h;
      h2 = h + 30;
      h3 = h - 25;
      break;
    case "complementary":
      h1 = h;
      h2 = h + 180;
      h3 = h + 180;
      break;
    case "split":
      h1 = h;
      h2 = h + 150;
      h3 = h + 210;
      break;
    case "triadic":
      h1 = h;
      h2 = h + 120;
      h3 = h + 240;
      break;
    case "tetradic":
      h1 = h;
      h2 = h + 90;
      h3 = h + 270;
      break;
  }

  return {
    name: `gen-${mode}-${appearance}`,
    colors: [
      oklchToHex(Lbg, Cbg, h), // [0] background
      oklchToHex(Ldark, Cdark, h1), // [1] mid-tone primary
      oklchToHex(Lmid, Cmid, h1), // [2] vivid primary
      oklchToHex(Lharm, Charm, h2), // [3] harmony accent
      oklchToHex(Llight, Clight, h3), // [4] detail
    ],
  };
}

// ── Renderer ──────────────────────────────────────────────────────────────────
export type ChromaRenderer = {
  draw: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    appearance: Appearance,
  ) => void;
  /** Palette base background (colors[0]) for an appearance — for theme-color match. */
  baseColor: (appearance: Appearance) => string;
};

/**
 * Build a chroma renderer bound to `uuid` (random per call by default). Both the
 * light and dark palettes are precomputed from the same seed (identical hues,
 * different lightness ramp) so the renderer can follow the OS theme live. The
 * grain texture depends only on the seed-derived noise, so it is baked once.
 */
export function createChromaRenderer(
  uuid: string = crypto.randomUUID(),
): ChromaRenderer {
  const seed = seedFromUuid(uuid);
  const noise2D = createNoise2D(mulberry32(seed + 1));

  // Each palette uses its own fresh stream (seed ^ 0xdeadbeef) — same draws,
  // same hues; only the appearance-dependent lightness/chroma ramp differs.
  const palettes: Record<Appearance, Palette> = {
    dark: generatePalette(mulberry32(seed ^ 0xdeadbeef), HARMONY, "dark"),
    light: generatePalette(mulberry32(seed ^ 0xdeadbeef), HARMONY, "light"),
  };

  // Bake the grain texture once (lazy — keeps `document` out of module init / SSR).
  let grainCanvas: HTMLCanvasElement | null = null;
  const getGrain = (): HTMLCanvasElement => {
    if (grainCanvas) return grainCanvas;
    const c = document.createElement("canvas");
    c.width = GRAIN_RES;
    c.height = GRAIN_RES;
    const gctx = c.getContext("2d")!;
    const gdata = new Uint8ClampedArray(GRAIN_RES * GRAIN_RES * 4);
    for (let py = 0; py < GRAIN_RES; py++) {
      for (let px = 0; px < GRAIN_RES; px++) {
        const n1 = noise2D(px * 4.3, py * 4.3);
        const n2 = noise2D(px * 9.1 + 100, py * 8.7 + 200);
        const v = Math.round((n1 * 0.65 + n2 * 0.35) * 127.5 + 127.5);
        const idx = (py * GRAIN_RES + px) * 4;
        gdata[idx] = v;
        gdata[idx + 1] = v;
        gdata[idx + 2] = v;
        gdata[idx + 3] = 255;
      }
    }
    gctx.putImageData(new ImageData(gdata, GRAIN_RES, GRAIN_RES), 0, 0);
    grainCanvas = c;
    return c;
  };

  const draw: ChromaRenderer["draw"] = (ctx, width, height, time, appearance) => {
    const colors = palettes[appearance].colors;
    const bg = colors[0];
    const accents = colors.slice(1);
    const lightBg = isLightHex(bg);

    // Orb positions use a fresh render stream every frame (positions stable;
    // only the simplex drift `t` advances over time).
    const rng = mulberry32(seed);

    const t = time * AMBIENT_SPEED;

    // Background
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const n = Math.round(ORB_COUNT);
    const minDim = Math.min(width, height);

    // Orbs — screen blend on dark bg (glowing), multiply on light bg (blooming)
    ctx.globalCompositeOperation = lightBg ? "multiply" : "screen";

    for (let i = 0; i < n; i++) {
      const baseX = rng() * width;
      const baseY = rng() * height;
      const r = ORB_RADIUS * minDim * (0.5 + rng() * 0.7);
      const dx = noise2D(i * 5.7, t) * minDim * 0.18;
      const dy = noise2D(i * 5.7 + 43.1, t) * minDim * 0.18;
      const x = baseX + dx;
      const y = baseY + dy;

      const color = accents[i % accents.length];
      const [cr, cg, cb] = hexToRgb(color);

      const innerFrac = 1 / GLOW_SOFTNESS;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
      grad.addColorStop(innerFrac, `rgba(${cr},${cg},${cb},0.7)`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";

    // Vignette — soft edge darkening to pull focus to the orbs
    const vCx = width / 2;
    const vCy = height / 2;
    const vInner = Math.min(width, height) * 0.25;
    const vOuter = Math.max(width, height) * 0.75;
    const vig = ctx.createRadialGradient(vCx, vCy, vInner, vCx, vCy, vOuter);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, `rgba(0,0,0,${lightBg ? 0.05 : 0.28})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);

    // Film grain — two-octave simplex noise baked into a small tiled texture.
    if (GRAIN_AMOUNT > 0.005) {
      const pat = ctx.createPattern(getGrain(), "repeat")!;
      ctx.fillStyle = pat;
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = GRAIN_AMOUNT;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  };

  return { draw, baseColor: (a) => palettes[a].colors[0] };
}
