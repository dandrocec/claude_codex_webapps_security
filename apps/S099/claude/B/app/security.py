"""Password / secret hashing using Argon2id (strong, salted, no length limit)."""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHash

_ph = PasswordHasher()


def hash_secret(plaintext: str) -> str:
    """Hash a password or client secret. A random salt is generated per call."""
    return _ph.hash(plaintext)


def verify_secret(stored_hash: str, plaintext: str) -> bool:
    """Constant-time-ish verification that never raises to the caller."""
    try:
        return _ph.verify(stored_hash, plaintext)
    except (VerifyMismatchError, VerificationError, InvalidHash, TypeError, ValueError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _ph.check_needs_rehash(stored_hash)
    except Exception:
        return False
