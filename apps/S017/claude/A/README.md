# Currency Converter

A minimal Flask web app that converts an amount between currencies using a fixed
list of hard-coded exchange rates.

## Features

- Enter an amount and pick a source and target currency from a fixed list.
- On submit, the converted amount is shown.
- Basic input validation (numeric, non-negative amount; valid currencies).

## Requirements

- Python 3.8+

## Running locally

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
   http://localhost:5017
   ```

The app listens on port **5017**.

## Notes

Exchange rates are hard-coded in `app.py` (`RATES`, expressed as units per 1
USD) and are for demonstration only — they are not live market rates.
