# PHP Discussion Forum

A small but production-minded discussion forum built with plain **PHP 8.1+** and
**PDO/SQLite**. Users register and log in; they browse **boards**, start
**threads**, and post **replies**. A **moderator** role can delete any post.
Threads are listed newest-first with a live reply count.

No external PHP packages are required — only standard extensions — so it runs
with nothing but PHP installed.

---

## Requirements

- PHP **8.1 or newer** with the `pdo_sqlite` and `mbstring` extensions
  (both ship with default PHP builds).
- That's it. (A `composer.json` is included to declare the runtime
  requirements and convenience scripts, but `composer install` is optional —
  there are no third-party dependencies to download.)

Check your PHP:

```bash
php -v
php -m | grep -E 'pdo_sqlite|mbstring'
```

---

## Run it locally on port 5058

From the project root:

```bash
# 1. (optional) create your local config
cp .env.example .env

# 2. start the server on port 5058
php -S 127.0.0.1:5058 router.php
```

Then open <http://127.0.0.1:5058>.

The SQLite database and three starter boards are created automatically on the
first request (stored at `./data/forum.sqlite`).

> If you have Composer, `composer serve` runs the same command.

### Try it

1. Click **Register**, create an account — you're logged in automatically.
2. Open a board, **start a thread**, and **post replies**.
3. You can delete **your own** posts. Moderators can delete **anyone's**.

### Make a moderator

Register a normal account through the web UI, then promote it from the CLI:

```bash
php bin/promote.php <username>            # grant moderator
php bin/promote.php <username> user       # revoke back to normal user
```

(There are deliberately **no** hardcoded admin credentials.)

---

## Configuration (environment variables)

All settings are read from the environment; for local dev a `.env` file is
loaded as a fallback (real env vars always win). See `.env.example`.

| Variable        | Default                | Purpose                                              |
|-----------------|------------------------|------------------------------------------------------|
| `APP_ENV`       | `production`           | `development` shows error details on screen.         |
| `DB_PATH`       | `./data/forum.sqlite`  | SQLite file location.                                |
| `SESSION_NAME`  | `forum_sid`            | Session cookie name.                                 |
| `SECURE_COOKIE` | `false`                | Set `true` behind HTTPS to send the `Secure` flag.   |

> SQLite needs no username/password, so there are no DB secrets to manage here.
> When deploying behind HTTPS, set `SECURE_COOKIE=true` and `APP_ENV=production`.

---

## Project layout

```
router.php              Built-in-server router (serves static files / front controller)
public/index.php        Front controller + route table
src/
  bootstrap.php         Error handling, sessions, security headers
  config.php            Env loading & configuration
  db.php                PDO connection, schema migration, seeding
  helpers.php           Escaping, CSRF, auth, validation, view rendering
  controllers.php       Route handlers (boards, threads, replies, auth)
  views/                HTML templates (escaped output)
bin/promote.php         CLI: grant/revoke the moderator role
```

---

## Security overview (OWASP Top 10)

This app implements the security controls requested:

- **SQL injection** — every query uses **PDO prepared statements** with bound
  parameters; emulated prepares are disabled.
- **Password storage** — `password_hash()` with **bcrypt (cost 12)**, a unique
  per-password salt, and transparent rehash-on-login.
- **XSS** — all dynamic output is HTML-escaped via a single `e()` helper
  (`htmlspecialchars`, `ENT_QUOTES`, UTF-8); a strict **Content-Security-Policy**
  blocks inline/3rd-party scripts as defence-in-depth.
- **CSRF** — every state-changing request requires a per-session token verified
  with `hash_equals()`; `SameSite=Lax` cookies add a second layer.
- **Access control / IDOR** — delete actions re-check ownership server-side
  against the authenticated user; only the author or a moderator may delete.
- **Input validation** — server-side length/format checks on usernames,
  passwords, titles, bodies, and integer IDs (`filter_input`).
- **Session security** — `HttpOnly`, `SameSite=Lax`, and `Secure` (when
  `SECURE_COOKIE=true`) cookie flags; strict mode; session id rotation on login.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Cross-Origin-Opener-Policy`, and HSTS (HTTPS).
- **Error handling** — stack traces are logged server-side, never shown to
  clients in production (`APP_ENV=production`).
- **Secrets** — read from environment variables; nothing sensitive is hardcoded.
