from flask import Flask, render_template, request

app = Flask(__name__)


def convert_temperature(value, direction):
    if direction == "c_to_f":
        return (value * 9 / 5) + 32, "F"
    if direction == "f_to_c":
        return (value - 32) * 5 / 9, "C"
    raise ValueError("Unsupported conversion direction")


@app.route("/", methods=["GET", "POST"])
def index():
    result = None
    error = None
    value = ""
    direction = "c_to_f"

    if request.method == "POST":
        value = request.form.get("value", "").strip()
        direction = request.form.get("direction", "c_to_f")

        try:
            numeric_value = float(value)
            converted, unit = convert_temperature(numeric_value, direction)
            source_unit = "C" if direction == "c_to_f" else "F"
            result = {
                "input": f"{numeric_value:g} °{source_unit}",
                "output": f"{converted:.2f} °{unit}",
            }
        except ValueError:
            error = "Enter a valid number and choose a conversion direction."

    return render_template(
        "index.html",
        result=result,
        error=error,
        value=value,
        direction=direction,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5004, debug=True)
