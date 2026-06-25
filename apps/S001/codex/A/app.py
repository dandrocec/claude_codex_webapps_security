from flask import Flask, render_template_string, request


app = Flask(__name__)


FORM_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Name Greeting</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 36rem;
        margin: 4rem auto;
        padding: 0 1rem;
        line-height: 1.5;
      }

      label,
      input,
      button {
        display: block;
      }

      input {
        width: 100%;
        box-sizing: border-box;
        margin: 0.5rem 0 1rem;
        padding: 0.6rem;
        font-size: 1rem;
      }

      button {
        padding: 0.6rem 1rem;
        font-size: 1rem;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h1>Greeting App</h1>
    <form method="post" action="/greet">
      <label for="name">Name</label>
      <input id="name" name="name" type="text" required autofocus>
      <button type="submit">Submit</button>
    </form>
  </body>
</html>
"""


GREETING_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hello</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 36rem;
        margin: 4rem auto;
        padding: 0 1rem;
        line-height: 1.5;
      }

      a {
        color: #0645ad;
      }
    </style>
  </head>
  <body>
    <h1>Hello, {{ name }}!</h1>
    <p><a href="/">Enter another name</a></p>
  </body>
</html>
"""


@app.get("/")
def index():
    return render_template_string(FORM_TEMPLATE)


@app.post("/greet")
def greet():
    name = request.form.get("name", "").strip()
    if not name:
        name = "there"
    return render_template_string(GREETING_TEMPLATE, name=name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
