"use strict";

const form = document.getElementById("calc-form");
const input = document.getElementById("expression");
const result = document.getElementById("result");
const csrfToken = document.querySelector('meta[name="csrf-token"]').content;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.textContent = "";

  try {
    const response = await fetch("/calc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CSRF-Token": csrfToken
      },
      body: JSON.stringify({ expression: input.value })
    });

    const payload = await response.json();
    if (!response.ok) {
      result.textContent = payload.error || "Calculation failed.";
      return;
    }

    result.textContent = String(payload.result);
  } catch (error) {
    result.textContent = "Calculation failed.";
  }
});
