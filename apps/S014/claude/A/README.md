# Inspirational Quotes

A tiny Flask app that shows a random inspirational quote on every page load,
with a button to fetch another random quote without reloading.

## Requirements

- Python 3.8+

## Run locally

1. (Optional) Create and activate a virtual environment:

   ```bash
   python -m venv venv
   # Windows (PowerShell)
   venv\Scripts\Activate.ps1
   # macOS / Linux
   source venv/bin/activate
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Start the app:

   ```bash
   python app.py
   ```

4. Open your browser at:

   ```
   http://localhost:5014
   ```

Each page load shows a random quote. Click **Show another quote** to fetch a
new one via the `/api/quote` JSON endpoint.
