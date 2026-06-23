"""Secure handling of resume uploads.

Hardening applied here:
  * Accept only an explicit allow-list of types (PDF, DOC, DOCX).
  * Validate by *inspecting file content* (magic bytes / container shape),
    never by trusting the client filename or Content-Type header.
  * Store under a server-generated random name, so the user-supplied
    filename never touches the filesystem (defeats path traversal and
    overwrite attacks).
  * Files live in a dedicated upload directory that is not served as code
    and is never used to resolve a path from user input.
"""
import io
import os
import uuid
import zipfile

# extension -> human label, used only for the *stored* name suffix.
ALLOWED = {"pdf": "application/pdf", "doc": "application/msword", "docx": "docx"}


def _looks_like_docx(blob: bytes) -> bool:
    """A .docx is a ZIP container; confirm it really is one and that it
    carries the OOXML word/ part rather than an arbitrary zip."""
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            names = zf.namelist()
    except zipfile.BadZipFile:
        return False
    return "[Content_Types].xml" in names and any(
        n.startswith("word/") for n in names
    )


def sniff_type(blob: bytes) -> str | None:
    """Return the canonical extension ('pdf'|'doc'|'docx') based purely on
    the file's content, or None if it is not an allowed type."""
    if blob.startswith(b"%PDF-"):
        return "pdf"
    # Legacy OLE2 compound document (.doc).
    if blob.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "doc"
    # ZIP signature -> could be a .docx; verify the container shape.
    if blob.startswith(b"PK\x03\x04") and _looks_like_docx(blob):
        return "docx"
    return None


def save_resume(file_storage, upload_dir: str) -> tuple[str, str]:
    """Validate and persist an uploaded resume.

    Returns (stored_name, ext). Raises ValueError on any rejection.
    The caller is responsible for enforcing the global request size limit
    (Flask MAX_CONTENT_LENGTH) which guards against oversized uploads.
    """
    if file_storage is None or not file_storage.filename:
        raise ValueError("No file was uploaded.")

    blob = file_storage.read()
    if not blob:
        raise ValueError("The uploaded file is empty.")

    ext = sniff_type(blob)
    if ext is None:
        raise ValueError("Unsupported file. Only PDF, DOC and DOCX resumes are allowed.")

    # Server-generated random name; the user filename is discarded entirely.
    stored_name = f"{uuid.uuid4().hex}.{ext}"

    # Resolve safely and confirm the final path stays inside upload_dir.
    base = os.path.realpath(upload_dir)
    os.makedirs(base, exist_ok=True)
    dest = os.path.realpath(os.path.join(base, stored_name))
    if os.path.dirname(dest) != base:
        # Should be impossible (uuid hex only), but defend in depth.
        raise ValueError("Invalid upload path.")

    with open(dest, "wb") as out:
        out.write(blob)

    return stored_name, ext


def resolve_stored_path(stored_name: str, upload_dir: str) -> str | None:
    """Return the on-disk path for a previously stored resume, or None if
    the name escapes the upload directory or does not exist.

    `stored_name` comes from our own database, but we still re-validate to
    guarantee no path traversal can occur.
    """
    base = os.path.realpath(upload_dir)
    # Reject anything that is not a bare filename.
    if os.path.basename(stored_name) != stored_name:
        return None
    candidate = os.path.realpath(os.path.join(base, stored_name))
    if os.path.dirname(candidate) != base or not os.path.isfile(candidate):
        return None
    return candidate
