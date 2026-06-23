"""End-to-end smoke test of the identity provider using FastAPI's TestClient.

Run:  python smoke_test.py
Exercises: discovery -> jwks -> admin login -> create client -> authorize ->
login -> token exchange -> userinfo, plus offline JWT verification via JWKS.
"""
import sys

import jwt
from fastapi.testclient import TestClient
from jwt import PyJWKClient

from app.main import app

client_id = "demo-client"
client_secret = "demo-secret"
redirect_uri = "http://localhost:5099/callback-demo"


def main() -> int:
    # follow_redirects=False so we can read the Location header on /login.
    c = TestClient(app, follow_redirects=False)

    # Discovery + JWKS.
    disc = c.get("/.well-known/openid-configuration").json()
    assert disc["issuer"] == "http://localhost:5099", disc
    jwks_doc = c.get("/.well-known/jwks.json").json()
    assert jwks_doc["keys"], "empty JWKS"
    print("discovery + jwks OK")

    # Admin login + create a client through the admin page.
    r = c.post("/admin/login", data={"username": "admin", "password": "admin123"})
    assert r.status_code == 303, r.status_code
    r = c.post(
        "/admin/clients",
        data={"name": "Test App", "redirect_uris": redirect_uri},
    )
    assert r.status_code == 303, r.status_code
    print("admin login + client creation OK")

    # Authorize (no session yet) renders the login form.
    r = c.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid profile email",
            "state": "xyz",
        },
    )
    assert r.status_code == 200 and "Sign in" in r.text, r.status_code

    # Submit credentials -> redirect to redirect_uri?code=...
    fresh = TestClient(app, follow_redirects=False)
    r = fresh.post(
        "/login",
        data={
            "username": "admin",
            "password": "admin123",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid profile email",
            "state": "xyz",
        },
    )
    assert r.status_code == 303, (r.status_code, r.text)
    location = r.headers["location"]
    assert location.startswith(redirect_uri) and "code=" in location, location
    code = location.split("code=")[1].split("&")[0]
    assert "state=xyz" in location
    print("authorize + login -> code OK")

    # Exchange the code for tokens.
    r = fresh.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    assert r.status_code == 200, (r.status_code, r.text)
    tokens = r.json()
    assert tokens["token_type"] == "Bearer"
    access_token = tokens["access_token"]
    id_token = tokens["id_token"]
    print("token exchange OK")

    # Reusing the same code must fail (one-time use).
    r = fresh.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    assert r.status_code == 400, r.status_code
    print("auth-code single-use enforced OK")

    # userinfo with the access token.
    r = fresh.get("/userinfo", headers={"Authorization": f"Bearer {access_token}"})
    assert r.status_code == 200, (r.status_code, r.text)
    info = r.json()
    assert info["preferred_username"] == "admin", info
    print("userinfo OK:", info)

    # Offline verification of the id_token using the published JWKS.
    jwk_client = PyJWKClient("http://testserver/.well-known/jwks.json")
    # PyJWKClient fetches over HTTP; instead verify directly from the JWKS doc.
    signing_key = jwt.PyJWK(jwks_doc["keys"][0]).key
    claims = jwt.decode(
        id_token,
        signing_key,
        algorithms=["RS256"],
        audience=client_id,
        issuer="http://localhost:5099",
    )
    assert claims["sub"] and claims["preferred_username"] == "admin", claims
    print("offline JWKS signature verification OK")

    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
