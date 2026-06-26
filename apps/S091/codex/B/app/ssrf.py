import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from app.config import get_settings


BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


class PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_title = False
        self.title_parts: list[str] = []
        self.description = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True
        if tag.lower() == "meta":
            attr_map = {k.lower(): (v or "") for k, v in attrs}
            name = attr_map.get("name", "").lower()
            prop = attr_map.get("property", "").lower()
            if name == "description" or prop == "og:description":
                self.description = attr_map.get("content", "")[:300]
            if prop == "og:title" and not self.title_parts:
                self.title_parts = [attr_map.get("content", "")[:200]]

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


def _blocked_ip(ip_text: str) -> bool:
    ip = ipaddress.ip_address(ip_text)
    return any(ip in network for network in BLOCKED_NETWORKS) or ip.is_private or ip.is_loopback or ip.is_link_local


def validate_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("URL must use http or https and include a host.")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not allowed.")
    infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    addresses = {info[4][0] for info in infos}
    if not addresses or any(_blocked_ip(address) for address in addresses):
        raise ValueError("URL resolves to a blocked address.")
    return url


async def fetch_preview(url: str) -> dict[str, str]:
    settings = get_settings()
    current_url = validate_url(url)
    timeout = httpx.Timeout(settings.link_preview_timeout, connect=settings.link_preview_timeout)
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        for _ in range(4):
            response = await client.get(current_url, headers={"User-Agent": "MicroblogPreview/1.0"})
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    break
                current_url = validate_url(urljoin(current_url, location))
                continue
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                return {"url": current_url, "title": current_url, "description": ""}
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > settings.link_preview_max_bytes:
                    body = body[: settings.link_preview_max_bytes]
                    break
            parser = PreviewParser()
            parser.feed(body.decode(response.encoding or "utf-8", errors="replace"))
            title = " ".join(" ".join(parser.title_parts).split())[:200] or current_url
            description = " ".join(parser.description.split())[:300]
            return {"url": current_url, "title": title, "description": description}
    return {"url": current_url, "title": current_url, "description": ""}
