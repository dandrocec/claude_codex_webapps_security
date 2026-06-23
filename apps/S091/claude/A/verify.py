"""End-to-end smoke test using FastAPI's TestClient (no network port needed).

Run after installing requirements:
    python verify.py
"""
import os
import time

os.environ["MICROBLOG_DB"] = "verify_microblog.db"
os.environ["RUN_WORKER_INLINE"] = "1"  # worker runs in-process for the test

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main():
    with TestClient(app) as c:  # triggers startup (init db, seed, worker)
        assert c.get("/healthz").json() == {"status": "ok"}

        users = c.get("/api/users").json()
        print("seeded users:", [u["username"] for u in users])
        assert len(users) >= 3
        alice = next(u for u in users if u["username"] == "alice")["id"]
        bob = next(u for u in users if u["username"] == "bob")["id"]

        # bob follows alice
        r = c.post(f"/api/users/{bob}/follow", json={"target_id": alice})
        assert r.status_code == 201, r.text

        # alice posts with a URL
        r = c.post(
            "/api/posts",
            json={"author_id": alice, "content": "Hello! https://example.com"},
        )
        assert r.status_code == 201, r.text
        post_id = r.json()["id"]
        print("created post:", post_id)

        # wait for the worker to fan out + fetch the preview
        timeline = []
        preview_status = None
        for _ in range(20):
            time.sleep(0.5)
            timeline = c.get(f"/api/timeline/{bob}").json()
            if timeline:
                previews = timeline[0].get("previews", [])
                if previews and previews[0]["status"] != "pending":
                    preview_status = previews[0]["status"]
                    break

        assert timeline, "post never fanned out to bob's timeline"
        print("bob's timeline length:", len(timeline))
        print("first post content:", timeline[0]["content"])
        print("preview status:", preview_status, "->", timeline[0].get("previews"))
        assert any(p["content"] == "Hello! https://example.com" for p in timeline)

        # UI renders
        assert c.get("/").status_code == 200
        assert "Microblog" in c.get("/").text

    print("\nALL CHECKS PASSED ✅")


if __name__ == "__main__":
    main()
