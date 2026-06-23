"""RSA signing key management and JWT signing/verification (RS256).

Tokens are signed with a private RSA key that never leaves the server. Client
applications verify them using the public key published at the JWKS endpoint.
"""
import os
import json
import base64
import hashlib
import logging

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from .config import get_settings

log = logging.getLogger("idp.keys")
settings = get_settings()


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _int_to_b64url(n: int) -> str:
    length = (n.bit_length() + 7) // 8
    return _b64url(n.to_bytes(length, "big"))


class KeyManager:
    def __init__(self) -> None:
        self._private_key = None
        self._public_key = None
        self._private_pem = None
        self.kid = None

    def load(self) -> None:
        if settings.private_key_pem:
            self._private_key = serialization.load_pem_private_key(
                settings.private_key_pem.encode("utf-8"), password=None
            )
        else:
            path = os.path.join(settings.keys_dir, "private.pem")
            if os.path.exists(path):
                with open(path, "rb") as fh:
                    self._private_key = serialization.load_pem_private_key(fh.read(), password=None)
            else:
                log.warning("No signing key found; generating a new RSA-2048 key at %s", path)
                self._private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
                os.makedirs(settings.keys_dir, exist_ok=True)
                pem = self._private_key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
                with open(path, "wb") as fh:
                    fh.write(pem)
                try:
                    os.chmod(path, 0o600)
                except OSError:
                    pass

        self._public_key = self._private_key.public_key()
        self._private_pem = self._private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        self.kid = self._compute_kid()

    def _compute_kid(self) -> str:
        # RFC 7638 JWK thumbprint.
        numbers = self._public_key.public_numbers()
        jwk = {
            "e": _int_to_b64url(numbers.e),
            "kty": "RSA",
            "n": _int_to_b64url(numbers.n),
        }
        canonical = json.dumps(jwk, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return _b64url(hashlib.sha256(canonical).digest())

    def jwks(self) -> dict:
        numbers = self._public_key.public_numbers()
        return {
            "keys": [
                {
                    "kty": "RSA",
                    "use": "sig",
                    "alg": "RS256",
                    "kid": self.kid,
                    "n": _int_to_b64url(numbers.n),
                    "e": _int_to_b64url(numbers.e),
                }
            ]
        }

    def sign(self, claims: dict) -> str:
        return jwt.encode(
            claims, self._private_pem, algorithm="RS256", headers={"kid": self.kid}
        )

    def verify(self, token: str) -> dict:
        """Verify signature, issuer and expiry. Raises jwt exceptions on failure."""
        return jwt.decode(
            token,
            self._public_key,
            algorithms=["RS256"],
            issuer=settings.issuer,
            options={"verify_aud": False, "require": ["exp", "iat", "iss", "sub"]},
        )


key_manager = KeyManager()
