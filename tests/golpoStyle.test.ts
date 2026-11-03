import { describe, it, expect } from 'vitest';
import {
  GOLPO_CANVAS,
  GOLPO_PALETTE,
  jitterPath,
  strokeDurationSec,
  quantizeToGolpoPalette,
} from '../services/golpoStyle';

type Pt = { x: number; y: number };

/** Perpendicular distance from p to the infinite line through a-b. */
const distToLine = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.hypot(dx, dy);
};

describe('GOLPO_CANVAS / GOLPO_PALETTE', () => {
  it('matches the 1536x1024 3:2 Golpo canvas on off-white paper', () => {
    expect(GOLPO_CANVAS.width).toBe(1536);
    expect(GOLPO_CANVAS.height).toBe(1024);
    expect(GOLPO_CANVAS.width / GOLPO_CANVAS.height).toBeCloseTo(1.5);
    expect(GOLPO_CANVAS.background.toUpperCase()).toBe('#FEFEFD');
  });

  it('contains the core Golpo ink/fill/accent/shadow colors as valid hex', () => {
    const values = Object.values(GOLPO_PALETTE).map((v) => String(v).toUpperCase());
    for (const v of values) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    for (const c of ['#1B1009', '#CFAF8A', '#D66A3A', '#7A5A3F']) expect(values).toContain(c);
  });
});

describe('jitterPath', () => {
  const line: Pt[] = [{ x: 0, y: 100 }, { x: 600, y: 100 }];

  it('is deterministic for the same seed', () => {
    expect(jitterPath(line, 42)).toEqual(jitterPath(line, 42));
  });

  it('differs for different seeds', () => {
    expect(jitterPath(line, 1)).not.toEqual(jitterPath(line, 2));
  });

  it('works without an explicit seed and stays deterministic', () => {
    expect(jitterPath(line)).toEqual(jitterPath(line));
  });

  it('does not mutate its input', () => {
    const input = line.map((p) => ({ ...p }));
    jitterPath(input, 7);
    expect(input).toEqual(line);
  });

  it('keeps wobble within the 2-4px hand-drawn band (never more than 4px off the line)', () => {
    const out = jitterPath(line, 123);
    expect(out.length).toBeGreaterThan(2);
    const offsets = out.map((p) => distToLine(p, line[0], line[1]));
    expect(Math.max(...offsets)).toBeLessThanOrEqual(4 + 1e-9);
    // it must actually wobble - a ruler-straight line is not Golpo
    expect(Math.max(...offsets)).toBeGreaterThan(0.5);
  });

  it('preserves the endpoints', () => {
    const out = jitterPath(line, 9);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[1]);
  });

  it('produces finite coordinates for multi-segment paths', () => {
    const poly: Pt[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 200, y: 200 }];
    for (const p of jitterPath(poly, 5)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('handles degenerate input', () => {
    expect(jitterPath([], 1)).toEqual([]);
    expect(jitterPath([{ x: 3, y: 4 }], 1)).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('strokeDurationSec', () => {
  it('is clamped to [0.6, 1.2] seconds', () => {
    for (const len of [0, 1, 10, 100, 600, 2000, 1e6, -50]) {
      const d = strokeDurationSec(len);
      expect(d).toBeGreaterThanOrEqual(0.6);
      expect(d).toBeLessThanOrEqual(1.2);
    }
    expect(strokeDurationSec(0)).toBeCloseTo(0.6);
    expect(strokeDurationSec(1e6)).toBeCloseTo(1.2);
  });

  it('is monotonic non-decreasing in length', () => {
    let prev = 0;
    for (let len = 0; len <= 5000; len += 50) {
      const d = strokeDurationSec(len);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('never returns NaN for bad input', () => {
    expect(Number.isNaN(strokeDurationSec(Number.NaN))).toBe(false);
  });
});

describe('quantizeToGolpoPalette', () => {
  const allowed = [GOLPO_CANVAS.background, ...Object.values(GOLPO_PALETTE)].map((c) => String(c).toUpperCase());

  it('maps exact palette colors to themselves', () => {
    for (const hex of Object.values(GOLPO_PALETTE)) {
      const v = parseInt(String(hex).slice(1), 16);
      const out = quantizeToGolpoPalette((v >> 16) & 255, (v >> 8) & 255, v & 255);
      expect(out.toUpperCase()).toBe(String(hex).toUpperCase());
    }
  });

  it('always returns a hex color from the Golpo set', () => {
    for (const [r, g, b] of [[0, 0, 255], [0, 255, 0], [255, 0, 255], [128, 128, 128], [0, 0, 0], [255, 255, 255]]) {
      const out = quantizeToGolpoPalette(r, g, b);
      expect(out).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(allowed).toContain(out.toUpperCase());
    }
  });

  it('snaps black to ink and orange to accent', () => {
    expect(quantizeToGolpoPalette(0, 0, 0).toUpperCase()).toBe(GOLPO_PALETTE.ink.toUpperCase());
    expect(quantizeToGolpoPalette(220, 100, 50).toUpperCase()).toBe(GOLPO_PALETTE.accent.toUpperCase());
  });

  it('snaps white toward paper rather than a fill color', () => {
    expect(quantizeToGolpoPalette(255, 255, 255).toUpperCase()).toBe(GOLPO_CANVAS.background.toUpperCase());
  });
});
