from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="File Upload App")

# Serve uploaded files for download. Using StaticFiles gives us correct
# content types and streaming for free.
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def safe_filename(filename: str) -> str:
    """Reduce an uploaded filename to a safe basename.

    Strips any directory components so a crafted name like
    "../../etc/passwd" cannot escape the uploads directory.
    """
    name = Path(filename).name
    return name or "unnamed"


UPLOAD_PAGE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Upload a file</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }}
    .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; }}
    button {{ padding: .5rem 1rem; cursor: pointer; }}
    a {{ color: #2563eb; }}
  </style>
</head>
<body>
  <h1>Upload a file</h1>
  <div class="card">
    <form action="/upload" method="post" enctype="multipart/form-data">
      <p><input type="file" name="file" required></p>
      <p><button type="submit">Upload</button></p>
    </form>
  </div>
  <p><a href="/files">View uploaded files &rarr;</a></p>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return UPLOAD_PAGE


@app.post("/upload")
async def upload(file: UploadFile = File(...)) -> RedirectResponse:
    filename = safe_filename(file.filename or "")
    destination = UPLOAD_DIR / filename

    with destination.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)

    return RedirectResponse(url="/files", status_code=303)


@app.get("/files", response_class=HTMLResponse)
def list_files() -> str:
    files = sorted(p.name for p in UPLOAD_DIR.iterdir() if p.is_file())

    if files:
        items = "\n".join(
            f'<li><a href="/uploads/{name}" download>{name}</a></li>'
            for name in files
        )
        listing = f"<ul>{items}</ul>"
    else:
        listing = "<p>No files uploaded yet.</p>"

    return f"""
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Uploaded files</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }}
    a {{ color: #2563eb; }}
    li {{ margin: .25rem 0; }}
  </style>
</head>
<body>
  <h1>Uploaded files</h1>
  {listing}
  <p><a href="/">&larr; Upload another file</a></p>
</body>
</html>
"""


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5010, reload=True)
