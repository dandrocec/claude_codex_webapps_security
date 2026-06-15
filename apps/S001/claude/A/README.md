# Flask Greeter

A tiny web app that asks for your name and greets you. No database required.

## Requirements

- Python 3.8+

## Run locally (port 5001)

1. (Optional) Create and activate a virtual environment:

   **Windows (PowerShell):**
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

   **macOS / Linux:**
   ```bash
   python3 -m venv venv
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

4. Open your browser to <http://localhost:5001>.

Enter a name, click **Submit**, and you'll see `Hello, <name>!`.
