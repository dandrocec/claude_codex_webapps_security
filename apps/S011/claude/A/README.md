# Image Resizer

A small Flask web app that resizes uploaded images. You upload an image and
choose a target width; the app generates a resized thumbnail (aspect ratio
preserved) and shows it with a download link.

## Features

- Upload PNG, JPG, GIF, BMP, or WEBP images
- Choose any target width (1–5000 px); height scales automatically
- Inline preview plus a one-click download link
- Input validation and a 16 MB upload limit

## Requirements

- Python 3.8+

## Setup & run (local, port 5011)

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

4. Open your browser to:

   ```
   http://localhost:5011
   ```

The app listens on port **5011** as configured at the bottom of `app.py`.

## Notes

- Resized images are written to a `thumbnails/` directory next to `app.py`.
- For production, run behind a WSGI server (e.g. `gunicorn`) and set a real
  `SECRET_KEY` environment variable instead of using `python app.py`.
