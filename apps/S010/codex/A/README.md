# FastAPI File Uploads

A small FastAPI application for uploading files, saving them in the `uploads` directory, and listing uploaded files with download links.

## Run locally

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the server on port 5010:

```bash
uvicorn main:app --host 0.0.0.0 --port 5010
```

Open `http://localhost:5010` to upload a file. Open `http://localhost:5010/files` to view and download uploaded files.
