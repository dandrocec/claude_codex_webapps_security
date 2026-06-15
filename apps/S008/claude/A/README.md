# QR Code Generator

A small Flask web app that turns text or a URL into a QR code. Enter your
content in the form, view the generated QR code on the result page, and
download it as a PNG.

## Features

- Generate a QR code from any text or URL
- Preview the QR code in the browser
- Download the QR code as a PNG file

## Requirements

- Python 3.8+

## Setup & Running Locally

1. (Optional) Create and activate a virtual environment:

   ```bash
   python -m venv venv
   # Windows
   venv\Scripts\activate
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
   http://localhost:5008
   ```

The app listens on **port 5008**.

## Project Structure

```
.
├── app.py              # Flask application
├── requirements.txt    # Python dependencies
├── templates/
│   ├── index.html      # Input form
│   └── result.html     # Result page with QR preview & download
└── static/
    └── style.css       # Styling
```
