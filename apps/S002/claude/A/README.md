# BMI Calculator

A minimal web app built with Node.js and Express. It shows a form asking for
height (cm) and weight (kg), computes the Body-Mass Index on submit, and renders
the value along with its category (Underweight / Normal / Overweight / Obese).

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (includes npm)

## Run locally

From the project directory:

```bash
npm install
npm start
```

Then open your browser at:

```
http://localhost:5002
```

## How it works

- `GET /` serves the input form.
- `POST /` reads the submitted height and weight, computes
  `BMI = weight(kg) / height(m)^2`, and displays the result page.

### BMI categories

| BMI range     | Category    |
| ------------- | ----------- |
| below 18.5    | Underweight |
| 18.5 – 24.9   | Normal      |
| 25.0 – 29.9   | Overweight  |
| 30.0 and above| Obese       |
