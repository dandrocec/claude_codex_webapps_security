# Flask Recipe Manager

A small Flask application for registering users, logging in, and managing recipes with optional photos. Recipes are stored in SQLite.

## Run locally

1. Create a virtual environment:
   ```bash
   python -m venv .venv
   ```
2. Activate it:
   ```bash
   .venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the app on port 5031:
   ```bash
   python app.py
   ```
5. Open:
   ```text
   http://localhost:5031
   ```

The SQLite database is created automatically at `instance/recipes.sqlite`.
