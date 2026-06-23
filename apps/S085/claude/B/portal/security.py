"""Security helpers: password hashing and content-based file validation."""

from __future__ import annotations

import io
import zipfile

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

# Argon2id with library defaults (memory/time cost tuned for interactive logins).
# Salting is handled internally and stored in the encoded hash string.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        _hasher.verify(stored_hash, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


# --- File upload content validation -----------------------------------------
#
# We do NOT trust the client-supplied filename or Content-Type. Instead the
# first bytes of the uploaded stream are inspected to confirm the real type,
# and the type must be on an explicit allow-list.

# extension shown to humans -> human label
ALLOWED_EXTENSIONS = {"pdf": "PDF", "docx": "Word (.docx)", "doc": "Word (.doc)"}

_PDF_MAGIC = b"%PDF-"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # legacy .doc (OLE2)
_ZIP_MAGIC = b"PK\x03\x04"  # .docx is a ZIP container


def detect_filetype(stream) -> str | None:
    """Inspect file content and return a canonical extension, or ``None``.

    ``stream`` is a file-like object; the read position is restored afterwards.
    """
    pos = stream.tell()
    head = stream.read(2048)
    stream.seek(pos)

    if head.startswith(_PDF_MAGIC):
        return "pdf"
    if head.startswith(_OLE_MAGIC):
        return "doc"
    if head.startswith(_ZIP_MAGIC):
        # Confirm it is really an OOXML Word document, not just any ZIP.
        if _is_docx(stream, pos):
            return "docx"
    return None


def _is_docx(stream, pos: int) -> bool:
    try:
        stream.seek(pos)
        data = stream.read()
        stream.seek(pos)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            return "[Content_Types].xml" in names and any(
                n.startswith("word/") for n in names
            )
    except (zipfile.BadZipFile, OSError):
        stream.seek(pos)
        return False
