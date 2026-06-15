# Tip Calculator (PHP)

A single-page web app. Enter a **bill amount**, **tip percentage**, and
**number of people**; on submit it shows the **tip amount**, the **total**, and
the **amount each person owes**. The form and results live on one page.

## Requirements

- PHP **8.1+** (uses the built-in web server — no database, no Composer
  packages required). [Composer](https://getcomposer.org/) is optional and only
  used here to expose a `start` script.

## Run locally on port 5003

1. Set the required secret (the app refuses to start without it):

   **PowerShell**
   ```powershell
   $env:APP_SECRET = (php -r "echo bin2hex(random_bytes(32));")
   ```

   **bash / zsh**
   ```bash
   export APP_SECRET="$(php -r 'echo bin2hex(random_bytes(32));')"
   ```

   (See `.env.example` for details.)

2. Start the server from the project directory:

   ```bash
   php -S 127.0.0.1:5003 -t .
   ```

   Or, with Composer installed:

   ```bash
   composer start
   ```

3. Open <http://127.0.0.1:5003> in your browser.

## Security controls

OWASP Top 10 best practices are applied **where they map to this app's scope**.
Because the app has **no database and no authentication**, a few of the
mandatory items have no attack surface to defend; the table records that
explicitly rather than adding fake login/DB code to tick a box.

| Requirement | Status in this app |
|---|---|
| **SQL injection / parameterised queries** | No database is used, so there are no queries. If one is added, use PDO prepared statements exclusively. |
| **Password hashing (bcrypt/Argon2)** | No auth surface. The correct approach is documented in `hash_password_reference()` using `password_hash()` with `PASSWORD_ARGON2ID`. |
| **Input validation & sanitisation** | All three inputs are validated with `filter_var` (type + numeric range) before use; non-numeric or out-of-range input is rejected. |
| **Output encoding / XSS** | Every dynamic value is escaped with `htmlspecialchars(..., ENT_QUOTES \| ENT_HTML5)` via the `e()` helper. A strict Content-Security-Policy is also set. |
| **CSRF protection** | A per-session, secret-derived token guards the state-changing `POST`, verified with `hash_equals()`. `SameSite=Strict` cookies add defence in depth. |
| **Access control / IDOR** | The app is stateless and exposes no per-user objects or IDs, so there is nothing to authorize across users. |
| **Secure session cookies** | `HttpOnly`, `SameSite=Strict`, and `Secure` (auto-enabled under HTTPS) via `session_set_cookie_params`. |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Content-Security-Policy`, `Permissions-Policy`, and HSTS under HTTPS. |
| **No leaked stack traces** | `display_errors` off; a global exception handler logs internally and returns a generic message. |
| **No hardcoded secrets** | `APP_SECRET` is read from the environment; the app fails closed if it is missing. |

## Files

- `index.php` — form, validation, calculation, and rendering.
- `style.css` — styling (served same-origin to satisfy the CSP).
- `composer.json` — dependency manifest / `start` script.
- `.env.example` — documents the required `APP_SECRET`.
