# Calc API

A tiny Node.js / Express JSON API that evaluates math expressions, plus a
single-page web UI that posts to it.

## Endpoint

`POST /calc`

Request body (JSON):

```json
{ "expression": "2 + 3 * 4" }
```

Response (JSON):

```json
{ "expression": "2 + 3 * 4", "result": 14 }
```

On a bad request the API responds with HTTP 400 and `{ "error": "..." }`.

Supported operators: `+ - * / %`, exponentiation `^`, unary `+`/`-`, and
parentheses. Expressions are parsed with a shunting-yard evaluator — **not**
`eval` — so arbitrary client-supplied code is never executed.

## Requirements

- Node.js 16 or newer (includes npm)

## Run it locally (port 5022)

```bash
npm install
npm start
```

Then open <http://localhost:5022> in your browser and use the form, or call the
API directly:

```bash
curl -X POST http://localhost:5022/calc \
  -H "Content-Type: application/json" \
  -d "{\"expression\": \"2 + 3 * 4\"}"
```

The server listens on port 5022 by default. To use a different port, set the
`PORT` environment variable, e.g. `PORT=8080 npm start`.
