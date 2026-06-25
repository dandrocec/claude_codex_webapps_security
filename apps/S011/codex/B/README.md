# Flask Image Resizer

A small Flask app that lets registered users upload JPEG, PNG, or WebP images, choose a target width, generate a resized thumbnail, preview it, and download it.

## Run locally on port 5011

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set SECRET_KEY=replace-with-a-long-random-secret
set SESSION_COOKIE_SECURE=false
python app.py
```

Open `http://127.0.0.1:5011`.

For production, set a strong `SECRET_KEY`, keep `SESSION_COOKIE_SECURE=true`, run behind HTTPS, and store the `instance` directory outside any executable or publicly served path.
