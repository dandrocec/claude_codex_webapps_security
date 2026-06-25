# Secure QR Generator

A Flask web app that lets registered users turn text or an `http`/`https` URL into a QR code, view it in the browser, and download it as a PNG.

## Run locally on port 5008

1. Create and activate a virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set a secret key and run the app:

   ```bash
   export SECRET_KEY="replace-with-a-long-random-value"
   export SESSION_COOKIE_SECURE="false"
   python app.py
   ```

   On Windows PowerShell:

   ```powershell
   $env:SECRET_KEY="replace-with-a-long-random-value"
   $env:SESSION_COOKIE_SECURE="false"
   python app.py
   ```

4. Open `http://127.0.0.1:5008`.

The app stores data in `instance/app.db` by default. Override that path with the `DATABASE_PATH` environment variable if needed.
