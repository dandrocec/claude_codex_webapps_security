# Password Strength Checker

A small Node.js / Express app. Type a candidate password into the form and the
server rates it **weak / medium / strong** based on length and character
variety, with brief feedback on how to improve it.

## How it scores

A password earns points for:

- length ≥ 8 (+1) and length ≥ 12 (+1 more)
- containing lowercase letters (+1)
- containing uppercase letters (+1)
- containing digits (+1)
- containing symbols (+1)

The total (0–6) maps to a rating:

| Score | Rating |
|-------|--------|
| 0–2   | weak   |
| 3–4   | medium |
| 5–6   | strong |

## Requirements

- [Node.js](https://nodejs.org/) 16 or newer (includes `npm`)

## Run it locally

From this directory:

```bash
npm install
npm start
```

Then open <http://localhost:5018> in your browser.

To run on a different port, set the `PORT` environment variable, e.g.:

```bash
# macOS / Linux
PORT=3000 npm start

# Windows (PowerShell)
$env:PORT=3000; npm start
```

## API

You can also call the endpoint directly:

```bash
curl -X POST http://localhost:5018/check \
  -H "Content-Type: application/json" \
  -d '{"password":"Tr0ub4dour&3"}'
```

Response:

```json
{
  "rating": "strong",
  "score": 6,
  "feedback": ["Great password!"]
}
```

## Project structure

```
.
├── server.js          # Express server + routes
├── strength.js        # Password rating logic (unit-testable, no deps)
├── public/
│   └── index.html     # Form + client-side UI
├── package.json
└── README.md
```

> **Note:** This tool is a strength estimator for educational use. Passwords are
> evaluated in-memory and never stored or logged, but avoid submitting real
> production credentials.
