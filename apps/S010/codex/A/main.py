from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="FastAPI File Uploads")


def safe_filename(filename: str) -> str:
    name = Path(filename or "uploaded-file").name.strip()
    return name or "uploaded-file"


def unique_upload_path(filename: str) -> Path:
    candidate = UPLOAD_DIR / filename
    if not candidate.exists():
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix
    counter = 1
    while True:
        numbered = UPLOAD_DIR / f"{stem}-{counter}{suffix}"
        if not numbered.exists():
            return numbered
        counter += 1


def page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f8fb;
      color: #172033;
    }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: start center;
    }}
    main {{
      width: min(720px, calc(100% - 32px));
      margin: 56px auto;
      background: #ffffff;
      border: 1px solid #d9e0ea;
      border-radius: 8px;
      box-shadow: 0 16px 40px rgba(31, 42, 68, 0.08);
      padding: 32px;
    }}
    h1 {{
      margin: 0 0 20px;
      font-size: 28px;
      line-height: 1.2;
    }}
    nav {{
      display: flex;
      gap: 12px;
      margin-bottom: 28px;
    }}
    a {{
      color: #075f73;
      font-weight: 650;
      text-decoration: none;
    }}
    a:hover {{
      text-decoration: underline;
    }}
    form {{
      display: grid;
      gap: 16px;
    }}
    input[type="file"] {{
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid #bfccd9;
      border-radius: 6px;
      background: #fbfcfe;
    }}
    button {{
      justify-self: start;
      border: 0;
      border-radius: 6px;
      background: #126b52;
      color: #ffffff;
      font-weight: 700;
      padding: 11px 16px;
      cursor: pointer;
    }}
    button:hover {{
      background: #0d573f;
    }}
    ul {{
      padding-left: 20px;
      margin: 0;
    }}
    li {{
      margin: 10px 0;
      overflow-wrap: anywhere;
    }}
    .empty {{
      margin: 0;
      color: #5e6b7c;
    }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">Upload</a>
      <a href="/files">Files</a>
    </nav>
    {body}
  </main>
</body>
</html>"""
    )


@app.get("/", response_class=HTMLResponse)
async def upload_form() -> HTMLResponse:
    return page(
        "Upload a file",
        """<h1>Upload a file</h1>
<form action="/upload" method="post" enctype="multipart/form-data">
  <input type="file" name="file" required>
  <button type="submit">Upload</button>
</form>""",
    )


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> RedirectResponse:
    filename = safe_filename(file.filename)
    upload_path = unique_upload_path(filename)

    with upload_path.open("wb") as destination:
        while chunk := await file.read(1024 * 1024):
            destination.write(chunk)

    return RedirectResponse(url="/files", status_code=303)


@app.get("/files", response_class=HTMLResponse)
async def list_files() -> HTMLResponse:
    files = sorted(path for path in UPLOAD_DIR.iterdir() if path.is_file())
    if not files:
        file_list = '<p class="empty">No files have been uploaded yet.</p>'
    else:
        items = "\n".join(
            f'<li><a href="/download/{quote(path.name)}">{path.name}</a></li>'
            for path in files
        )
        file_list = f"<ul>{items}</ul>"

    return page("Uploaded files", f"<h1>Uploaded files</h1>{file_list}")


@app.get("/download/{filename}")
async def download_file(filename: str) -> FileResponse:
    safe_name = safe_filename(filename)
    file_path = UPLOAD_DIR / safe_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, filename=safe_name)
