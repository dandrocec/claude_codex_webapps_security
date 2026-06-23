"""Password hashing, RSA signing keys, and JWT issuing/verification."""
import time
import uuid
from functools import lru_cache

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from passlib.context import CryptContext

from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "RS256"
KEY_ID = "idp-key-1"


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# --------------------------------------------------------------------------- #
# RSA signing keypair (generated and persisted on first run)
# --------------------------------------------------------------------------- #
def _ensure_keys() -> tuple[bytes, bytes]:
    settings.keys_dir.mkdir(parents=True, exist_ok=True)
    private_path = settings.keys_dir / "private.pem"
    public_path = settings.keys_dir / "public.pem"

    if not private_path.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_path.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        public_path.write_bytes(
            key.public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
        )
    return private_path.read_bytes(), public_path.read_bytes()


@lru_cache(maxsize=1)
def _keys() -> tuple[bytes, bytes]:
    return _ensure_keys()


def private_key_pem() -> bytes:
    return _keys()[0]


def public_key_pem() -> bytes:
    return _keys()[1]


def jwks() -> dict:
    """Return the public key as a JWKS document for client verification."""
    public_key = serialization.load_pem_public_key(public_key_pem())
    jwk = RSAAlgorithm.to_jwk(public_key, as_dict=True)
    jwk.update({"kid": KEY_ID, "use": "sig", "alg": ALGORITHM})
    return {"keys": [jwk]}


# --------------------------------------------------------------------------- #
# JWT issuing / verification
# --------------------------------------------------------------------------- #
def issue_token(*, subject: str, audience: str, ttl: int, extra_claims: dict | None = None) -> str:
    now = int(time.time())
    payload = {
        "iss": settings.issuer,
        "sub": subject,
        "aud": audience,
        "iat": now,
        "nbf": now,
        "exp": now + ttl,
        "jti": uuid.uuid4().hex,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, private_key_pem(), algorithm=ALGORITHM, headers={"kid": KEY_ID})


def decode_token(token: str, *, audience: str | None = None) -> dict:
    """Verify a token's signature and standard claims. Raises on failure."""
    options = {"verify_aud": audience is not None}
    return jwt.decode(
        token,
        public_key_pem(),
        algorithms=[ALGORITHM],
        audience=audience,
        issuer=settings.issuer,
        options=options,
    )
