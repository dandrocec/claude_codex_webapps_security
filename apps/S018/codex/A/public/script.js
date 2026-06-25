const form = document.querySelector("#password-form");
const passwordInput = document.querySelector("#password");
const toggleButton = document.querySelector("#toggle-password");
const result = document.querySelector("#result");
const rating = document.querySelector("#rating");
const meterBar = document.querySelector("#meter-bar");
const feedback = document.querySelector("#feedback");

toggleButton.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleButton.textContent = isHidden ? "Hide" : "Show";
  toggleButton.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await fetch("/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      password: passwordInput.value
    })
  });

  const data = await response.json();
  const ratingValue = data.rating || "weak";

  result.classList.remove("hidden");
  rating.textContent = ratingValue;
  rating.className = ratingValue;
  meterBar.className = ratingValue;

  feedback.replaceChildren(
    ...data.feedback.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    })
  );
});
