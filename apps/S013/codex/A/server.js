const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5013;
const DATA_DIR = path.join(__dirname, "data");
const COUNTER_FILE = path.join(DATA_DIR, "visits.json");

async function readVisitCount() {
  try {
    const raw = await fs.readFile(COUNTER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed.count) && parsed.count >= 0 ? parsed.count : 0;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function writeVisitCount(count) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(COUNTER_FILE, JSON.stringify({ count }, null, 2), "utf8");
}

function renderPage(count) {
  const plural = count === 1 ? "time" : "times";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Visit Counter</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, Helvetica, sans-serif;
        background: #f4f7f9;
        color: #1f2933;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      main {
        width: min(100%, 520px);
        padding: 40px;
        border: 1px solid #d8e0e7;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 18px 45px rgba(31, 41, 51, 0.08);
        text-align: center;
      }

      h1 {
        margin: 0 0 16px;
        font-size: 2rem;
        line-height: 1.2;
      }

      .count {
        display: block;
        margin: 18px 0;
        color: #0f766e;
        font-size: clamp(3rem, 18vw, 6rem);
        font-weight: 700;
        line-height: 1;
      }

      p {
        margin: 0;
        color: #52616f;
        font-size: 1.1rem;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Visit Counter</h1>
      <span class="count">${count}</span>
      <p>This page has been visited ${count} ${plural}.</p>
    </main>
  </body>
</html>`;
}

app.get("/", async (req, res, next) => {
  try {
    const count = (await readVisitCount()) + 1;
    await writeVisitCount(count);
    res.type("html").send(renderPage(count));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send("Unable to update the visit counter.");
});

app.listen(PORT, () => {
  console.log(`Visit counter app listening on http://localhost:${PORT}`);
});
