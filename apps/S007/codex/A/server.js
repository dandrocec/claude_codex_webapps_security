const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5007;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

function normalizeHex(input) {
  const raw = String(input || "").trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((char) => char + char)
      .join("")
      .toUpperCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }

  return null;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mixChannel(channel, target, amount) {
  return channel + (target - channel) * amount;
}

function shade(hex, amount) {
  const rgb = hexToRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const strength = Math.abs(amount);

  return rgbToHex({
    r: mixChannel(rgb.r, target, strength),
    g: mixChannel(rgb.g, target, strength),
    b: mixChannel(rgb.b, target, strength)
  });
}

function generatePalette(hex) {
  return [-0.42, -0.21, 0, 0.22, 0.45].map((amount) => shade(hex, amount));
}

app.get("/", (req, res) => {
  res.render("index", {
    input: "#4F7CAC",
    palette: generatePalette("#4F7CAC"),
    error: null
  });
});

app.post("/", (req, res) => {
  const input = req.body.colour;
  const hex = normalizeHex(input);

  if (!hex) {
    return res.status(400).render("index", {
      input,
      palette: [],
      error: "Enter a valid 3- or 6-digit hex colour, such as #4F7CAC."
    });
  }

  return res.render("index", {
    input: hex,
    palette: generatePalette(hex),
    error: null
  });
});

app.listen(PORT, () => {
  console.log(`Palette generator running on http://localhost:${PORT}`);
});
