# Hex Palette Generator

A small Node.js / Express web app. Enter a base hex colour and it generates and
displays a palette of five related shades — each swatch is shown with its hex value.

## Requirements

- [Node.js](https://nodejs.org/) 16 or newer (includes `npm`)

## Run locally

From the project directory:

```bash
npm install
npm start
```

Then open <http://localhost:5007> in your browser.

To use a different port, set the `PORT` environment variable, e.g.
`PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`).

## How it works

- The form accepts a base hex colour in `#rrggbb` or shorthand `#rgb` form
  (the leading `#` is optional). A native colour picker is kept in sync with the
  text field.
- On submit, the colour is converted to HSL and five shades are produced by
  spreading the lightness from light to dark while keeping hue and saturation
  fixed.
- Each shade is rendered as a swatch labelled with its hex value. Invalid input
  is reported back on the form.

## Project layout

```
.
├── server.js        # Express server + colour/palette logic
├── package.json     # Dependency manifest
├── public/
│   └── styles.css   # Styles
└── README.md
```
