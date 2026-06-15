from flask import Flask, render_template, request

app = Flask(__name__)


def convert(value, direction):
    """Convert a temperature value based on the chosen direction."""
    if direction == "c2f":
        return value * 9 / 5 + 32
    if direction == "f2c":
        return (value - 32) * 5 / 9
    raise ValueError(f"Unknown direction: {direction}")


@app.route("/", methods=["GET", "POST"])
def index():
    result = None
    error = None
    value = ""
    direction = "c2f"

    if request.method == "POST":
        value = request.form.get("value", "").strip()
        direction = request.form.get("direction", "c2f")
        try:
            number = float(value)
            converted = convert(number, direction)
            unit = "°F" if direction == "c2f" else "°C"
            source_unit = "°C" if direction == "c2f" else "°F"
            result = f"{number:g} {source_unit} = {converted:.2f} {unit}"
        except ValueError:
            error = "Please enter a valid number."

    return render_template(
        "index.html", result=result, error=error, value=value, direction=direction
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5004, debug=True)
