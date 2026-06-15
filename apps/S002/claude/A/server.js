const express = require('express');

const app = express();
const PORT = 5002;

// Parse URL-encoded form bodies (from the HTML form POST).
app.use(express.urlencoded({ extended: false }));

function pageLayout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #f4f6f8;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #fff;
      padding: 2rem 2.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      width: 320px;
      text-align: center;
    }
    h1 { font-size: 1.4rem; margin-top: 0; color: #222; }
    label { display: block; text-align: left; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; color: #444; }
    input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      box-sizing: border-box;
      font-size: 1rem;
    }
    button {
      margin-top: 1.25rem;
      width: 100%;
      padding: 0.6rem;
      background: #2d7ff9;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #1c6fe0; }
    .bmi-value { font-size: 2.2rem; font-weight: 700; margin: 0.5rem 0; color: #2d7ff9; }
    .category { font-size: 1.1rem; margin-bottom: 1rem; color: #333; }
    .error { color: #c0392b; margin-bottom: 1rem; }
    a { color: #2d7ff9; text-decoration: none; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`;
}

function formBody(errorMessage) {
  const error = errorMessage ? `<p class="error">${errorMessage}</p>` : '';
  return `<h1>BMI Calculator</h1>
    ${error}
    <form method="POST" action="/">
      <label for="height">Height (cm)</label>
      <input type="number" id="height" name="height" step="0.1" min="1" required>
      <label for="weight">Weight (kg)</label>
      <input type="number" id="weight" name="weight" step="0.1" min="1" required>
      <button type="submit">Calculate BMI</button>
    </form>`;
}

function categorize(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

app.get('/', (req, res) => {
  res.send(pageLayout('BMI Calculator', formBody()));
});

app.post('/', (req, res) => {
  const height = parseFloat(req.body.height);
  const weight = parseFloat(req.body.weight);

  if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) {
    res
      .status(400)
      .send(pageLayout('BMI Calculator', formBody('Please enter valid positive numbers for height and weight.')));
    return;
  }

  const heightMeters = height / 100;
  const bmi = weight / (heightMeters * heightMeters);
  const category = categorize(bmi);

  const resultBody = `<h1>Your Result</h1>
    <div class="bmi-value">${bmi.toFixed(1)}</div>
    <div class="category">${category}</div>
    <a href="/">&larr; Calculate again</a>`;

  res.send(pageLayout('BMI Result', resultBody));
});

app.listen(PORT, () => {
  console.log(`BMI calculator running at http://localhost:${PORT}`);
});
