from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import Flask, render_template, request


app = Flask(__name__)

RATES_TO_USD = {
    "USD": Decimal("1"),
    "EUR": Decimal("1.08"),
    "GBP": Decimal("1.27"),
    "JPY": Decimal("0.0064"),
    "CAD": Decimal("0.73"),
    "AUD": Decimal("0.66"),
    "CHF": Decimal("1.12"),
}

CURRENCY_NAMES = {
    "USD": "US Dollar",
    "EUR": "Euro",
    "GBP": "British Pound",
    "JPY": "Japanese Yen",
    "CAD": "Canadian Dollar",
    "AUD": "Australian Dollar",
    "CHF": "Swiss Franc",
}


def convert(amount, source_currency, target_currency):
    amount_in_usd = amount * RATES_TO_USD[source_currency]
    converted = amount_in_usd / RATES_TO_USD[target_currency]
    return converted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@app.route("/", methods=["GET", "POST"])
def index():
    currencies = list(RATES_TO_USD.keys())
    result = None
    error = None
    form = {
        "amount": request.form.get("amount", "100"),
        "source": request.form.get("source", "USD"),
        "target": request.form.get("target", "EUR"),
    }

    if request.method == "POST":
        try:
            amount = Decimal(form["amount"])
            if amount < 0:
                raise ValueError("Amount must be zero or greater.")

            source = form["source"]
            target = form["target"]
            if source not in RATES_TO_USD or target not in RATES_TO_USD:
                raise ValueError("Please choose valid currencies.")

            converted = convert(amount, source, target)
            result = {
                "amount": amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                "source": source,
                "target": target,
                "converted": converted,
            }
        except (InvalidOperation, ValueError) as exc:
            error = str(exc) if str(exc) else "Please enter a valid amount."

    return render_template(
        "index.html",
        currencies=currencies,
        currency_names=CURRENCY_NAMES,
        form=form,
        result=result,
        error=error,
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5017, debug=True)
