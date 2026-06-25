# Express Calculator API

A small Node.js/Express application with a JSON API endpoint and a simple browser UI.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the server on port `5022`:

```bash
npm start
```

Open `http://localhost:5022` in a browser.

## API

`POST /calc`

Request body:

```json
{
  "expression": "2 + 3 * 4"
}
```

Response:

```json
{
  "result": 14
}
```
