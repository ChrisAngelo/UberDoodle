/**
 * Golpo Fidelity Engine
 * ---------------------
 * Single source of truth for reproducing Golpo AI's hand-drawn whiteboard
 * doodle look (measured from a 1536x1024 / 30fps reference video, see
 * GOLPO_PRESET.md). Dependency-free; safe to import from browser or Node.
 */

export type GolpoPoint = { x: number; y: number };

export const GOLPO_CANVAS = { width: 1536, height: 1024, background: '#FEFEFD', aspect: 3 / 2 } as const;

export const GOLPO_PALETTE = {
  ink: '#1B1009',
  inkSoft: '#2F2315',
  fill: '#CFAF8A',
  fillLight: '#E5D8A4',
  mid: '#A87A52',
  accent: '#D66A3A',
  shadow: '#7A5A3F',
} as const;

export const GOLPO_STROKE = { width: 4, cap: 'round', join: 'round', jitterMin: 2, jitterMax: 4 } as const;

export const GOLPO_TIMING = { strokeDrawSec: 0.8, holdSec: 1.5, minStrokeSec: 0.6, maxStrokeSec: 1.2 } as const;

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

export const GOLPO_NEGATIVE_PROMPT = [
  'photorealistic', 'photograph', '3D render', 'CGI', 'gradients', 'airbrush', 'soft shading',
  'realistic lighting', 'glow', 'lens flare', 'bokeh', 'depth of field', 'texture overlays',
  'watercolor bleed', 'oil paint', 'anime', 'manga screentone', 'vector-perfect geometric lines',
  'neon or saturated colors', 'blue', 'green', 'purple', 'pink', 'pure black #000000',
  'pure white #FFFFFF background', 'colored or dark background', 'paper grain', 'drop shadows',
  'dense scribbles', 'cross-hatching everywhere', 'cluttered composition', 'busy background',
  'frames or borders', 'watermark', 'logo', 'signature', 'garbled or misspelled text',
  'gibberish lettering', 'typed computer fonts', 'extra fingers', 'deformed hands',
  'inconsistent character design', 'portrait or square framing',
].join(', ');

/**
 * Build an image-generation prompt that yields a Golpo-style whiteboard frame.
 * The output is plain text with labelled sections; models (Gemini/Imagen,
 * Flux, GPT-image) follow sectioned specs reliably.
 */
export function buildGolpoImagePrompt(
  sceneDescription: string,
  opts?: { characterLock?: string; textLabels?: string[] },
): string {
  const p = GOLPO_PALETTE;
  const scene = (sceneDescription || '').trim() || 'a simple explanatory concept sketch';
  const labels = (opts?.textLabels ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 4);
  const lines: string[] = [];

  lines.push(
    'STYLE: Hand-drawn whiteboard explainer doodle, drawn live with a thick felt-tip marker, ' +
      'in the style of a Golpo AI educational video frame. Friendly, minimal, instantly readable.',
  );
  lines.push(`SCENE: ${scene}`);

  if (opts?.characterLock?.trim()) {
    lines.push(
      `CHARACTER (keep EXACTLY identical across every frame - same proportions, face, hair, clothing, line style): ${opts.characterLock.trim()}`,
    );
  }

  lines.push(
    [
      'LINEWORK:',
      `- Clean, confident dark-brown ink outlines (${p.ink}, secondary ${p.inkSoft}), uniform ~4px marker weight at 1536x1024, round line ends.`,
      '- Slightly wobbly hand-drawn lines (2-4px organic waver on straight edges) - never ruler-perfect, never sketchy or hairy.',
      '- Sparse, deliberate strokes: low edge density, each object built from a few continuous lines. Lots of empty paper.',
      '- Shading only as a few simple parallel hatch lines; no tonal rendering.',
    ].join('\n'),
  );

  lines.push(
    [
      'COLOR (strict limited warm palette, flat fills only):',
      `- Paper/background: solid near-white ${GOLPO_CANVAS.background} filling the whole frame.`,
      `- Main fills: flat warm tan ${p.fill} and pale sand ${p.fillLight}.`,
      `- Secondary strokes/details: mid brown ${p.mid}; small shadows/dark areas: deep brown ${p.shadow}.`,
      `- Accent: orange ${p.accent} used ONLY for 1-2 points of emphasis (arrow, key word underline, highlight).`,
      '- Fills sit loosely inside outlines like quick marker coloring; no gradients, no other hues.',
    ].join('\n'),
  );

  lines.push(
    'COMPOSITION: 3:2 landscape (1536x1024). One clear focal subject, centered or rule-of-thirds, ' +
      'generous margins, 1-3 supporting icons max, simple arrows connecting ideas. Flat 2D, front or 3/4 view.',
  );

  if (labels.length) {
    lines.push(
      'TEXT: Include ONLY these hand-lettered labels, spelled exactly, in neat bold uppercase marker print in ' +
        `${p.ink} (key word may be underlined in ${p.accent}): ` +
        labels.map((l) => `"${l}"`).join(', ') +
        '. Large, legible, no other text.',
    );
  } else {
    lines.push('TEXT: No text or letters anywhere in the image.');
  }

  lines.push(`NEGATIVE PROMPT (avoid): ${GOLPO_NEGATIVE_PROMPT}.`);
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------
// Stroke geometry & timing
// ---------------------------------------------------------------------------

/** mulberry32: tiny deterministic PRNG returning [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Max segment length (px) before subdivision; ~one wobble per this distance. */
const JITTER_STEP_PX = 24;

/**
 * Add deterministic hand-drawn wobble: segments are subdivided every ~24px and
 * interior points are displaced perpendicular to the segment by a smooth
 * 2-4px offset (alternating sign + low-frequency drift, so it reads as a
 * steady hand rather than noise). Original vertices are preserved exactly so
 * corners and endpoints stay put.
 */
export function jitterPath(points: GolpoPoint[], seed = 1): GolpoPoint[] {
  if (!points || points.length < 2) return points ? points.map((p) => ({ ...p })) : [];
  const rand = mulberry32(seed);
  const { jitterMin, jitterMax } = GOLPO_STROKE;
  const out: GolpoPoint[] = [{ ...points[0] }];
  let phase = rand() * Math.PI * 2;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / JITTER_STEP_PX));
    if (len > 0 && n > 1) {
      const nx = -dy / len;
      const ny = dx / len;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const amp = jitterMin + rand() * (jitterMax - jitterMin);
        // sine envelope keeps offset small near endpoints, smooth in middle
        const env = Math.sin(Math.PI * t);
        const off = amp * Math.sin(phase + k * 1.7) * (0.5 + 0.5 * env);
        out.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
      }
      phase += n * 1.7;
    }
    out.push({ ...b });
  }
  return out;
}

/**
 * Draw-on duration for a stroke of the given length. Base 0.8s for a
 * ~600px stroke, scaled by sqrt(length) (long strokes speed up like a real
 * hand) and clamped to [0.6, 1.2]s.
 */
export function strokeDurationSec(pathLengthPx: number): number {
  const { strokeDrawSec, minStrokeSec, maxStrokeSec } = GOLPO_TIMING;
  const len = Number.isFinite(pathLengthPx) ? Math.max(0, pathLengthPx) : 0;
  const d = strokeDrawSec * Math.sqrt(len / 600);
  return Math.min(maxStrokeSec, Math.max(minStrokeSec, d));
}

/** Apply Golpo marker stroke settings, scaling width to the canvas size. */
export function applyGolpoContext(ctx: CanvasRenderingContext2D): void {
  const w = ctx.canvas?.width || GOLPO_CANVAS.width;
  const scale = w / GOLPO_CANVAS.width;
  ctx.strokeStyle = GOLPO_PALETTE.ink;
  ctx.fillStyle = GOLPO_PALETTE.fill;
  ctx.lineWidth = Math.max(1, GOLPO_STROKE.width * scale);
  ctx.lineCap = GOLPO_STROKE.cap;
  ctx.lineJoin = GOLPO_STROKE.join;
  ctx.miterLimit = 2;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Color post-processing
// ---------------------------------------------------------------------------

type Lab = [number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** sRGB (0-255) -> CIELAB (D65). */
function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Palette used for quantization: background is included so paper snaps to paper. */
const QUANT_HEX: string[] = [GOLPO_CANVAS.background, ...Object.values(GOLPO_PALETTE)];
const QUANT_RGB = QUANT_HEX.map(hexToRgb);
const QUANT_LAB = QUANT_RGB.map(([r, g, b]) => rgbToLab(r, g, b));

function nearestIndex(r: number, g: number, b: number): { idx: number; dist: number } {
  const [L, A, B] = rgbToLab(r, g, b);
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < QUANT_LAB.length; i++) {
    const q = QUANT_LAB[i];
    const d = (L - q[0]) ** 2 + (A - q[1]) ** 2 + (B - q[2]) ** 2; // CIE76 squared
    if (d < best) { best = d; idx = i; }
  }
  return { idx, dist: Math.sqrt(best) };
}

/**
 * Nearest Golpo color (incl. #FEFEFD paper) by CIELAB distance. Returns
 * uppercase hex like '#CFAF8A'.
 */
export function quantizeToGolpoPalette(r: number, g: number, b: number): string {
  return QUANT_HEX[nearestIndex(r, g, b).idx];
}

/**
 * Golpo-ize a generated frame in place (and return it):
 *  1. Bright near-neutral pixels (min channel >= 225, spread <= 18) and any
 *     pixel nearest to paper become exact #FEFEFD.
 *  2. Every other pixel is blended toward its nearest palette color by
 *     `strength` (0..1, default 0.75). Out-of-palette hues (blues, greens)
 *     are snapped harder so they can't survive.
 * Alpha is preserved.
 */
export function golpoizeImageData(img: ImageData, opts?: { strength?: number }): ImageData {
  const strength = Math.min(1, Math.max(0, opts?.strength ?? 0.75));
  const [bgR, bgG, bgB] = QUANT_RGB[0];
  const d = img.data;
  const cache = new Map<number, number>(); // quantized rgb key -> palette idx|dist<<4

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    // fast paper test: bright and nearly neutral
    if (min >= 225 && max - min <= 18) {
      d[i] = bgR; d[i + 1] = bgG; d[i + 2] = bgB;
      continue;
    }
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let packed = cache.get(key);
    if (packed === undefined) {
      const { idx, dist } = nearestIndex(r, g, b);
      packed = idx | (Math.min(255, Math.round(dist)) << 4);
      cache.set(key, packed);
    }
    const idx = packed & 15;
    const dist = packed >> 4;
    if (idx === 0) { d[i] = bgR; d[i + 1] = bgG; d[i + 2] = bgB; continue; }
    // far-from-palette colors get pushed harder (dist ~>30 = foreign hue)
    const s = Math.min(1, strength + Math.max(0, (dist - 20) / 60) * (1 - strength));
    const [pr, pg, pb] = QUANT_RGB[idx];
    d[i] = Math.round(r + (pr - r) * s);
    d[i + 1] = Math.round(g + (pg - g) * s);
    d[i + 2] = Math.round(b + (pb - b) * s);
  }
  return img;
}


/**
 * Browser-only: snap a generated image (data URL) toward the Golpo palette and paper.
 * Returns the input unchanged when no DOM canvas is available or on any failure.
 */
export async function golpoizeDataUrl(dataUrl: string, opts?: { strength?: number }): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return dataUrl;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(golpoizeImageData(data, opts), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}
