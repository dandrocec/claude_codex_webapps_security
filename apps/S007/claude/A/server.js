'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5007;

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Colour helpers ----------

// Normalise a user-supplied hex string into a 6-digit "#rrggbb" form, or
// return null when it isn't a valid hex colour.
function normaliseHex(input) {
  if (typeof input !== 'string') return null;
  let hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return '#' + hex.toLowerCase();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const to2 = (v) => Math.round(v).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b);
}

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
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Generate five related shades of the base colour by spreading lightness
// around the base while keeping hue and saturation fixed.
function buildPalette(hex) {
  const hsl = rgbToHsl(hexToRgb(hex));
  const targets = [0.85, 0.65, 0.5, 0.35, 0.2]; // light -> dark
  return targets.map((l) => {
    const shade = rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: clamp01(l) }));
    return { hex: shade, light: l > 0.55 };
  });
}

// ---------- Views ----------

function renderPage({ base, palette, error }) {
  const swatches = palette
    ? palette
        .map(
          (c) => `
        <div class="swatch" style="background:${c.hex}">
          <span class="hex ${c.light ? 'on-light' : 'on-dark'}">${c.hex}</span>
        </div>`
        )
        .join('')
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hex Palette Generator</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <h1>Hex Palette Generator</h1>
    <p class="lede">Enter a base hex colour to generate five related shades.</p>

    <form method="post" action="/" class="form">
      <label for="color">Base hex colour</label>
      <div class="row">
        <input type="color" id="picker"
               value="${base && base.length === 7 ? base : '#3b82f6'}"
               aria-label="Colour picker">
        <input type="text" id="color" name="color" placeholder="#3b82f6"
               value="${base ? base : ''}" required>
        <button type="submit">Generate</button>
      </div>
      ${error ? `<p class="error">${error}</p>` : ''}
    </form>

    ${palette ? `<section class="palette" aria-label="Generated palette">${swatches}</section>` : ''}
  </main>

  <script>
    // Keep the colour picker and text field in sync.
    var picker = document.getElementById('picker');
    var text = document.getElementById('color');
    if (picker && text) {
      picker.addEventListener('input', function () { text.value = picker.value; });
      text.addEventListener('input', function () {
        if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
      });
    }
  </script>
</body>
</html>`;
}

// ---------- Routes ----------

app.get('/', (req, res) => {
  res.send(renderPage({ base: '#3b82f6', palette: null, error: null }));
});

app.post('/', (req, res) => {
  const raw = req.body.color;
  const base = normaliseHex(raw);
  if (!base) {
    res.status(400).send(
      renderPage({
        base: typeof raw === 'string' ? raw : '',
        palette: null,
        error: 'Please enter a valid hex colour, e.g. #3b82f6 or #abc.',
      })
    );
    return;
  }
  res.send(renderPage({ base, palette: buildPalette(base), error: null }));
});

app.listen(PORT, () => {
  console.log(`Hex Palette Generator running at http://localhost:${PORT}`);
});
