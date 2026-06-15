# Text Diff (Flask)

A small Flask web app with two textareas. On submit, it computes the
line-by-line differences between the two texts and displays them with
**additions** highlighted in green and **removals** in red (GitHub-style).

The diff is computed server-side using Python's standard-library
[`difflib.SequenceMatcher`](https://docs.python.org/3/library/difflib.html),
so there are no dependencies beyond Flask itself.

## Requirements

- Python 3.8+

## Run locally

From the project directory:

```bash
# 1. (Optional) create and activate a virtual environment
python -m venv venv

# macOS / Linux
source venv/bin/activate
# Windows (PowerShell)
venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app (serves on port 5019)
python app.py
```

Then open <http://localhost:5019> in your browser.

## Usage

1. Paste the original text into the left textarea and the modified text
   into the right one.
2. Click **Compute diff**.
3. Lines unique to the modified text appear green with a `+`; lines unique
   to the original appear red with a `-`; unchanged lines are shown plainly.
