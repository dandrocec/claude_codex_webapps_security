"""A small Flask currency converter.

A form takes an amount and a source/target currency from a fixed list with
hard-coded rates. On submit, the converted amount is shown.
"""

from flask import Flask, render_template, request

app = Flask(__name__)

# Hard-coded exchange rates expressed as units of currency per 1 USD.
# Converting from A to B is: amount * (RATES[B] / RATES[A]).
RATES = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 156.0,
    "CAD": 1.37,
    "AUD": 1.51,
    "CHF": 0.90,
    "CNY": 7.24,
    "INR": 83.4,
    "BRL": 5.43,
}

CURRENCIES = sorted(RATES.keys())


def convert(amount, source, target):
    """Convert an amount from the source currency to the target currency."""
    return amount * (RATES[target] / RATES[source])


@app.route("/", methods=["GET", "POST"])
def index():
    result = None
    error = None
    # Sensible defaults so the form is pre-populated on first load.
    form = {"amount": "", "source": "USD", "target": "EUR"}

    if request.method == "POST":
        form["amount"] = request.form.get("amount", "").strip()
        form["source"] = request.form.get("source", "USD")
        form["target"] = request.form.get("target", "EUR")

        if form["source"] not in RATES or form["target"] not in RATES:
            error = "Please choose currencies from the list."
        else:
            try:
                amount = float(form["amount"])
            except ValueError:
                error = "Please enter a valid number for the amount."
            else:
                if amount < 0:
                    error = "Amount cannot be negative."
                else:
                    converted = convert(amount, form["source"], form["target"])
                    result = {
                        "amount": amount,
                        "source": form["source"],
                        "target": form["target"],
                        "converted": converted,
                    }

    return render_template(
        "index.html",
        currencies=CURRENCIES,
        result=result,
        error=error,
        form=form,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5017, debug=True)
