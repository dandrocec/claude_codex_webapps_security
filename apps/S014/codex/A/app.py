from random import choice

from flask import Flask, jsonify, render_template


app = Flask(__name__)

QUOTES = [
    {
        "text": "The best way to get started is to quit talking and begin doing.",
        "author": "Walt Disney",
    },
    {
        "text": "Do what you can, with what you have, where you are.",
        "author": "Theodore Roosevelt",
    },
    {
        "text": "It always seems impossible until it is done.",
        "author": "Nelson Mandela",
    },
    {
        "text": "Success is not final, failure is not fatal: it is the courage to continue that counts.",
        "author": "Winston Churchill",
    },
    {
        "text": "Believe you can and you're halfway there.",
        "author": "Theodore Roosevelt",
    },
    {
        "text": "Act as if what you do makes a difference. It does.",
        "author": "William James",
    },
    {
        "text": "Start where you are. Use what you have. Do what you can.",
        "author": "Arthur Ashe",
    },
    {
        "text": "The future depends on what you do today.",
        "author": "Mahatma Gandhi",
    },
]


def random_quote():
    return choice(QUOTES)


@app.get("/")
def index():
    return render_template("index.html", quote=random_quote())


@app.get("/api/quote")
def quote():
    return jsonify(random_quote())


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5014, debug=True)
