const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5018;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function analyzePassword(password) {
  const value = typeof password === "string" ? password : "";
  const length = value.length;

  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const varietyCount = [
    hasLowercase,
    hasUppercase,
    hasNumber,
    hasSymbol
  ].filter(Boolean).length;

  let score = 0;

  if (length >= 8) score += 1;
  if (length >= 12) score += 1;
  if (length >= 16) score += 1;
  if (varietyCount >= 2) score += 1;
  if (varietyCount >= 3) score += 1;
  if (varietyCount === 4) score += 1;

  let rating = "weak";
  if (score >= 5 && length >= 12 && varietyCount >= 3) {
    rating = "strong";
  } else if (score >= 3 && length >= 8 && varietyCount >= 2) {
    rating = "medium";
  }

  const feedback = [];

  if (length === 0) {
    feedback.push("Enter a password to get a strength rating.");
  } else {
    if (length < 8) feedback.push("Use at least 8 characters.");
    if (length < 12) feedback.push("Use 12 or more characters for better strength.");
    if (!hasLowercase) feedback.push("Add lowercase letters.");
    if (!hasUppercase) feedback.push("Add uppercase letters.");
    if (!hasNumber) feedback.push("Add at least one number.");
    if (!hasSymbol) feedback.push("Add a symbol such as !, ?, #, or %.");
  }

  if (feedback.length === 0) {
    feedback.push("This password has solid length and character variety.");
  }

  return {
    rating,
    score,
    length,
    checks: {
      hasLowercase,
      hasUppercase,
      hasNumber,
      hasSymbol,
      varietyCount
    },
    feedback
  };
}

app.post("/check", (req, res) => {
  res.json(analyzePassword(req.body.password));
});

app.listen(PORT, () => {
  console.log(`Password strength checker running on http://localhost:${PORT}`);
});

