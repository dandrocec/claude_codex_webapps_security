# Simple Online Shop

A minimal online shop built with **Flask** and **SQLite**.

## Features

- **Catalogue page** — lists all products with name, price, and description.
- **Product page** — shows product details and lets visitors post comments,
  which are stored in the database and displayed below the product.
- **Shopping cart** — held in the session, with per-line and running totals.
- **Persistence** — products and comments are stored in a SQLite database
  (`shop.db`), which is created and seeded with sample products on first run.

## Requirements

- Python 3.8+

## Run it locally (port 5057)

```bash
# 1. (optional) create and activate a virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://localhost:5057> in your browser.

The database (`shop.db`) is created automatically on first launch and seeded
with a few sample products. Delete the file if you want to reset the data.

## Project layout

```
app.py              # application + routes + DB setup
requirements.txt    # Python dependencies
templates/          # Jinja2 HTML templates
  base.html
  catalogue.html
  product.html
  cart.html
static/
  style.css         # stylesheet
shop.db             # SQLite database (auto-created)
```
