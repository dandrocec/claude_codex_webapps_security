from flask import Flask, request, render_template_string

app = Flask(__name__)

FORM_PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Greeter</title>
</head>
<body>
  <h1>Greeter</h1>
  <form action="/greet" method="post">
    <label for="name">Your name:</label>
    <input type="text" id="name" name="name" required autofocus>
    <button type="submit">Submit</button>
  </form>
</body>
</html>
"""

GREET_PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Greeter</title>
</head>
<body>
  <h1>Hello, {{ name }}!</h1>
  <p><a href="/">Back</a></p>
</body>
</html>
"""


@app.route("/")
def index():
    return render_template_string(FORM_PAGE)


@app.route("/greet", methods=["POST"])
def greet():
    name = request.form.get("name", "").strip() or "stranger"
    return render_template_string(GREET_PAGE, name=name)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
