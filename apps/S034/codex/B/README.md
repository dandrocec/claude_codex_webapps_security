# Flask Reading List

A small Flask app for tracking a personal reading list with SQLite storage.

## Run Locally

1. Create and activate a virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set a strong secret key:

   ```bash
   set FLASK_SECRET_KEY=replace-with-a-long-random-secret
   ```

   On macOS/Linux:

   ```bash
   export FLASK_SECRET_KEY=replace-with-a-long-random-secret
   ```

4. Start the app on port 5034:

   ```bash
   flask --app app run --host 127.0.0.1 --port 5034
   ```

The SQLite database is created automatically in `instance/reading_list.sqlite`.
