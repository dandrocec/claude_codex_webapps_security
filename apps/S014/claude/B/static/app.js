// Fetches a fresh quote without a full page reload.
// Uses textContent (never innerHTML) so quote data can never be interpreted
// as markup -> DOM-based XSS is not possible here.
(function () {
  "use strict";

  const button = document.getElementById("new-quote");
  const textEl = document.getElementById("quote-text");
  const authorEl = document.getElementById("quote-author");

  button.addEventListener("click", async function () {
    button.disabled = true;
    try {
      const response = await fetch("/api/quote", {
        headers: { "Accept": "application/json" },
      });
      if (!response.ok) {
        throw new Error("Request failed: " + response.status);
      }
      const quote = await response.json();
      textEl.textContent = "“" + quote.text + "”";
      authorEl.textContent = "— " + quote.author;
    } catch (err) {
      authorEl.textContent = "Could not load a new quote. Please try again.";
    } finally {
      button.disabled = false;
    }
  });
})();
