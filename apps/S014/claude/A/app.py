import random

from flask import Flask, jsonify, render_template

app = Flask(__name__)

QUOTES = [
    {"text": "The only way to do great work is to love what you do.", "author": "Steve Jobs"},
    {"text": "Success is not final, failure is not fatal: it is the courage to continue that counts.", "author": "Winston Churchill"},
    {"text": "Believe you can and you're halfway there.", "author": "Theodore Roosevelt"},
    {"text": "It does not matter how slowly you go as long as you do not stop.", "author": "Confucius"},
    {"text": "Everything you've ever wanted is on the other side of fear.", "author": "George Addair"},
    {"text": "The future belongs to those who believe in the beauty of their dreams.", "author": "Eleanor Roosevelt"},
    {"text": "Hardships often prepare ordinary people for an extraordinary destiny.", "author": "C.S. Lewis"},
    {"text": "Do what you can, with what you have, where you are.", "author": "Theodore Roosevelt"},
    {"text": "Act as if what you do makes a difference. It does.", "author": "William James"},
    {"text": "Quality is not an act, it is a habit.", "author": "Aristotle"},
    {"text": "Whether you think you can or you think you can't, you're right.", "author": "Henry Ford"},
    {"text": "The best time to plant a tree was 20 years ago. The second best time is now.", "author": "Chinese Proverb"},
]


def random_quote():
    return random.choice(QUOTES)


@app.route("/")
def index():
    return render_template("index.html", quote=random_quote())


@app.route("/api/quote")
def api_quote():
    return jsonify(random_quote())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5014, debug=True)
