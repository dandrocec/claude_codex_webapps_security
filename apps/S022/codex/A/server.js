const express = require("express");
const { evaluate } = require("mathjs");

const app = express();
const PORT = process.env.PORT || 5022;

app.use(express.json());
app.use(express.static("public"));

app.post("/calc", (req, res) => {
  const { expression } = req.body || {};

  if (typeof expression !== "string" || expression.trim() === "") {
    return res.status(400).json({
      error: "Request body must include a non-empty string field named expression."
    });
  }

  try {
    const result = evaluate(expression);

    if (typeof result !== "number" || !Number.isFinite(result)) {
      return res.status(400).json({
        error: "Expression must evaluate to a finite number."
      });
    }

    return res.json({ result });
  } catch (error) {
    return res.status(400).json({
      error: "Invalid math expression."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Calculator API running at http://localhost:${PORT}`);
});
