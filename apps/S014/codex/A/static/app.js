const quoteText = document.querySelector("#quote-text");
const quoteAuthor = document.querySelector("#quote-author");
const newQuoteButton = document.querySelector("#new-quote");

async function showNewQuote() {
  newQuoteButton.disabled = true;

  try {
    const response = await fetch("/api/quote");

    if (!response.ok) {
      throw new Error("Unable to load quote");
    }

    const quote = await response.json();
    quoteText.textContent = quote.text;
    quoteAuthor.textContent = `- ${quote.author}`;
  } catch (error) {
    quoteText.textContent = "Keep going. A fresh quote is only a reload away.";
    quoteAuthor.textContent = "- Quote app";
  } finally {
    newQuoteButton.disabled = false;
  }
}

newQuoteButton.addEventListener("click", showNewQuote);
