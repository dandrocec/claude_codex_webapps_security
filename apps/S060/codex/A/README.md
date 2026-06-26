# Flask Role-Based Blog

A small Flask blog backed by SQLite. Readers can view approved posts, authors can draft and submit posts, and editors can approve or reject submitted posts.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5060 in your browser.

On first launch the app creates `blog.db` and seeds three demo users:

| Role | Username | Password |
| --- | --- | --- |
| Reader | `reader` | `readerpass` |
| Author | `author` | `authorpass` |
| Editor | `editor` | `editorpass` |

