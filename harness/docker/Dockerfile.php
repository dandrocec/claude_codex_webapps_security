# Generic, security-NEUTRAL runtime for PHP apps (Apache + mod_php).
#
# This template provides ISOLATION + RUNTIME ONLY. It deliberately adds:
#   - NO hardening, NO security_opt, NO capability drops
#   - NO input validation, NO security headers (no mod_headers tweaks)
#   - NO dependency pinning/patching/auditing/upgrading
# Adding any of the above would contaminate the security experiment.

ARG PHP_TAG=apache
FROM php:${PHP_TAG}

WORKDIR /var/www/html

# Bring in composer ONLY to install the app's declared dependencies.
# This is dependency installation, not hardening.
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Copy the generated app verbatim. The source is never transformed.
COPY . /var/www/html

# Enable PHP extensions the generated apps declare in composer.json but that the
# official php images do NOT bundle: pdo_sqlite (SQLite-backed apps) and gd
# (image-processing apps, e.g. galleries/thumbnails that declare `ext-gd`).
# Installing a language extension the app itself declares it needs is RUNTIME
# ENABLEMENT (same class as installing declared composer/npm/pip deps), NOT
# hardening — it adds no security control and is applied identically to every
# PHP app and to both A and B variants. pdo_sqlite needs the sqlite3 dev headers
# (libsqlite3-dev); gd needs the png/jpeg/freetype dev headers to compile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libsqlite3-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo_sqlite gd \
    && rm -rf /var/lib/apt/lists/*

# Install declared PHP dependencies if a composer manifest is present.
# No --no-dev, no audit, no patching: install exactly what the app declares.
RUN if [ -f composer.json ]; then composer install --no-interaction; fi

# Port. NOTE: php:apache serves on Apache's own default port (80). If a spec
# declares a different port, the app itself must configure Apache to listen
# there; we do NOT reconfigure Apache, as that is beyond neutral isolation.
ARG APP_PORT
ENV APP_PORT=${APP_PORT}
EXPOSE ${APP_PORT}

# NOTE ON USER: there is intentionally NO `USER` instruction. We keep the
# php:apache image's own default behaviour (the entrypoint starts Apache as
# root, which then drops worker processes to www-data per Apache's stock
# config). We add and change nothing, because that would be a security control
# and would contaminate the experiment.

# Start command. If the compose generator injects a START_CMD (e.g. the PHP
# built-in server bound to the app's stated port, which is how these generated
# single-file PHP apps expect to run), use it; otherwise fall back to the
# php:apache base image's own Apache entrypoint on port 80. Either way this is
# only a runtime choice -- no hardening is added.
ARG START_CMD
ENV START_CMD=${START_CMD}
CMD ["sh", "-c", "if [ -n \"$START_CMD\" ]; then exec $START_CMD; else exec apache2-foreground; fi"]
