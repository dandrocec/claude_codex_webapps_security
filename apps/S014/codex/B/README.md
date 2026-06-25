# Daily Spark

A small Flask app that shows a random inspirational quote on each page load. Signed-in users can save quotes to their own favorites list.

## Run locally on port 5014

1. Create and activate a virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set a secret key:

   ```bash
   set SECRET_KEY=replace-with-a-long-random-value
   ```

   On macOS or Linux:

   ```bash
   export SECRET_KEY=replace-with-a-long-random-value
   ```

4. Start the app:

   ```bash
   python app.py
   ```

5. Open `http://127.0.0.1:5014`.

For local HTTP-only testing of login and favorites, set `SESSION_COOKIE_SECURE=false`. Leave it unset or set to `true` behind HTTPS.
