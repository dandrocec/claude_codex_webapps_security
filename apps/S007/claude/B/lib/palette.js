'use strict';

/**
 * Colour palette helpers.
 *
 * All functions here are pure and operate on already-validated input.
 * Validation/normalisation of untrusted user input lives in `normalizeHex`,
 * which is the single entry point the web layer should call.
 */

// Accept #RGB or #RRGGBB, case-insensitive, optional leading '#'.
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Validate and normalise an untrusted hex colour string into the canonical
 * lower-case `#rrggbb` form. Returns `null` when the input is not a valid hex
 * colour, so callers can reject without throwing.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const match = HEX_RE.exec(trimmed);
  if (!match) return null;

  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    // Expand shorthand: abc -> aabbcc
    hex = hex.split('').map((c) => c + c).join('');
  }
  return '#' + hex;
}

/** Convert a canonical `#rrggbb` string to an {r,g,b} object (0-255). */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Convert {r,g,b} (0-255) to canonical `#rrggbb`. */
function rgbToHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v) => clamp(v).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/** RGB (0-255) -> HSL (h:0-360, s/l:0-1). */
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

/** HSL (h:0-360, s/l:0-1) -> RGB (0-255). */
function hslToRgb({ h, s, l }) {
  h /= 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Generate a palette of five related shades from a canonical base hex colour,
 * by varying the lightness around the base while keeping hue and saturation.
 *
 * @param {string} baseHex canonical `#rrggbb` (output of normalizeHex)
 * @returns {{hex: string, label: string}[]} five swatches, dark -> light
 */
function generatePalette(baseHex) {
  const hsl = rgbToHsl(hexToRgb(baseHex));
  const offsets = [-0.3, -0.15, 0, 0.15, 0.3];
  const labels = ['Darkest', 'Dark', 'Base', 'Light', 'Lightest'];

  return offsets.map((offset, i) => {
    const shade = { h: hsl.h, s: hsl.s, l: clamp01(hsl.l + offset) };
    return { hex: rgbToHex(hslToRgb(shade)), label: labels[i] };
  });
}

module.exports = { normalizeHex, generatePalette };
