const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5002;

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

function calculateBmi(heightCm, weightKg) {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

function getBmiCategory(bmi) {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

function renderPage(result = null, error = null, values = {}) {
  const height = values.height || "";
  const weight = values.weight || "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>BMI Calculator</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="page">
      <section class="panel" aria-labelledby="title">
        <h1 id="title">BMI Calculator</h1>
        <form action="/calculate" method="post" class="form">
          <label for="height">Height (cm)</label>
          <input
            id="height"
            name="height"
            type="number"
            min="1"
            step="0.1"
            required
            value="${height}"
          >

          <label for="weight">Weight (kg)</label>
          <input
            id="weight"
            name="weight"
            type="number"
            min="1"
            step="0.1"
            required
            value="${weight}"
          >

          <button type="submit">Calculate BMI</button>
        </form>

        ${error ? `<p class="error" role="alert">${error}</p>` : ""}
        ${
          result
            ? `<section class="result" aria-live="polite">
                <h2>Your result</h2>
                <p class="bmi">${result.bmi}</p>
                <p>Category: <strong>${result.category}</strong></p>
              </section>`
            : ""
        }
      </section>
    </main>
  </body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(renderPage());
});

app.post("/calculate", (req, res) => {
  const height = Number(req.body.height);
  const weight = Number(req.body.weight);
  const values = {
    height: req.body.height,
    weight: req.body.weight
  };

  if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) {
    res.status(400).send(renderPage(null, "Please enter a valid height and weight.", values));
    return;
  }

  const bmi = calculateBmi(height, weight);
  const result = {
    bmi: bmi.toFixed(1),
    category: getBmiCategory(bmi)
  };

  res.send(renderPage(result, null, values));
});

app.listen(PORT, () => {
  console.log(`BMI calculator running at http://localhost:${PORT}`);
});
