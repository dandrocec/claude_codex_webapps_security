"""SSRF-hardened outbound HTTP fetcher for link previews.

Defences applied to every server-initiated request whose destination is derived
from user input:

  * Scheme allow-list: only http / https.
  * The hostname is resolved and EVERY resolved IP (A and AAAA) is checked
    against a deny-list of private, loopback, link-local, reserved, multicast and
    unspecified ranges. This blocks 127.0.0.0/8, 10/8, 172.16/12, 192.168/16,
    169.254.0.0/16 (incl. the 169.254.169.254 cloud-metadata endpoint), ::1 and
    fc00::/7, among others.
  * The validated IP is pinned for the actual TCP connection, so DNS cannot be
    re-resolved to a different (internal) address between validation and connect
    (DNS-rebinding / TOCTOU protection).
  * Redirects are NOT followed automatically; each hop is re-validated before we
    connect to it.
  * Connect/read timeouts and a hard cap on the number of bytes read.
"""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .config import settings

ALLOWED_SCHEMES = {"http", "https"}
_USER_AGENT = "MicroblogLinkPreview/1.0 (+https://example.invalid/bot)"


class SSRFError(Exception):
    """Raised when a URL is rejected by the SSRF guard."""


@dataclass
class Preview:
    url: str
    title: str | None = None
    description: str | None = None
    image_url: str | None = None


def _ip_is_blocked(ip_str: str) -> bool:
    ip = ipaddress.ip_address(ip_str)
    # Normalise IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) to its IPv4 form.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _resolve_and_validate(host: str, port: int) -> list[str]:
    """Resolve a hostname and return its safe IPs, or raise SSRFError."""
    # If the host is already a literal IP, validate it directly.
    try:
        literal = ipaddress.ip_address(host)
        if _ip_is_blocked(str(literal)):
            raise SSRFError("destination resolves to a blocked address")
        return [str(literal)]
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFError("DNS resolution failed") from exc

    ips = {info[4][0] for info in infos}
    if not ips:
        raise SSRFError("no addresses for host")
    for ip in ips:
        if _ip_is_blocked(ip):
            raise SSRFError("destination resolves to a blocked address")
    return list(ips)


def _validate_url(raw_url: str) -> tuple[str, str, int]:
    parsed = urlparse(raw_url)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise SSRFError("scheme not allowed")
    host = parsed.hostname
    if not host:
        raise SSRFError("missing host")
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    safe_ips = _resolve_and_validate(host, port)
    return safe_ips[0], host, port


def fetch_link_preview(raw_url: str) -> Preview:
    """Fetch and parse a link preview with full SSRF protection."""
    timeout = httpx.Timeout(
        connect=settings.LINK_PREVIEW_TIMEOUT,
        read=settings.LINK_PREVIEW_TIMEOUT,
        write=settings.LINK_PREVIEW_TIMEOUT,
        pool=settings.LINK_PREVIEW_TIMEOUT,
    )
    current = raw_url

    for _ in range(settings.LINK_PREVIEW_MAX_REDIRECTS + 1):
        ip, host, port = _validate_url(current)
        parsed = urlparse(current)

        # Pin the connection to the validated IP by connecting to the IP literal
        # while sending the real Host header. This closes the DNS-rebinding gap.
        connect_url = parsed._replace(
            netloc=f"[{ip}]:{port}" if ":" in ip else f"{ip}:{port}"
        ).geturl()
        headers = {
            "Host": host if port in (80, 443) else f"{host}:{port}",
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
        }

        with httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            verify=parsed.scheme == "https",
            headers=headers,
        ) as client:
            try:
                with client.stream(
                    "GET",
                    connect_url,
                    extensions={"sni_hostname": host},
                ) as resp:
                    if resp.is_redirect:
                        location = resp.headers.get("location")
                        if not location:
                            raise SSRFError("redirect without location")
                        # Resolve relative redirects against the ORIGINAL url
                        # (not the IP-rewritten one) and re-validate next loop.
                        current = str(httpx.URL(current).join(location))
                        continue
                    if resp.status_code != 200:
                        raise SSRFError(f"unexpected status {resp.status_code}")

                    content_type = resp.headers.get("content-type", "")
                    if "html" not in content_type.lower():
                        return Preview(url=current)

                    body = bytearray()
                    for chunk in resp.iter_bytes():
                        body.extend(chunk)
                        if len(body) >= settings.LINK_PREVIEW_MAX_BYTES:
                            break
                    return _parse_html(bytes(body[: settings.LINK_PREVIEW_MAX_BYTES]), current)
            except httpx.HTTPError as exc:
                raise SSRFError("request failed") from exc

    raise SSRFError("too many redirects")


def _meta(soup: BeautifulSoup, *, prop: str | None = None, name: str | None = None) -> str | None:
    if prop:
        tag = soup.find("meta", attrs={"property": prop})
        if tag and tag.get("content"):
            return tag["content"].strip()
    if name:
        tag = soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return None


def _parse_html(body: bytes, url: str) -> Preview:
    soup = BeautifulSoup(body, "html.parser")

    title = _meta(soup, prop="og:title")
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()

    description = _meta(soup, prop="og:description", name="description")
    image = _meta(soup, prop="og:image")

    def _clip(value: str | None, length: int) -> str | None:
        if value is None:
            return None
        return value[:length]

    return Preview(
        url=url,
        title=_clip(title, 500),
        description=_clip(description, 1000),
        image_url=_clip(image, 2000),
    )
