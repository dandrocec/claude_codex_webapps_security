"""Safe Markdown rendering.

User-supplied Markdown is converted to HTML and then run through an
allow-list sanitiser (bleach). This means even if a user embeds raw HTML or
script in their Markdown, the output cannot introduce XSS: disallowed tags
and attributes (e.g. <script>, onclick, javascript: URLs) are stripped.
"""
import bleach
import markdown as md

# Tags we permit in rendered wiki pages. Deliberately excludes <script>,
# <style>, <iframe>, event-handler-bearing elements, etc.
ALLOWED_TAGS = [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "b", "i", "u", "del", "ins", "sub", "sup",
    "blockquote", "code", "pre",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "a", "img",
]

ALLOWED_ATTRIBUTES = {
    "a": ["href", "title"],
    "img": ["src", "alt", "title"],
    "th": ["align"],
    "td": ["align"],
}

# Only safe URL schemes; this blocks javascript:/data: vectors.
ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def render_markdown(text: str) -> str:
    """Convert Markdown to sanitised, safe HTML."""
    raw_html = md.markdown(
        text or "",
        extensions=["fenced_code", "tables", "nl2br"],
        output_format="html",
    )
    clean_html = bleach.clean(
        raw_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    # Force external links to be safe (noopener) and relativise nothing.
    return bleach.linkify(
        clean_html,
        callbacks=[_set_link_rel],
        skip_tags=["pre", "code"],
    )


def _set_link_rel(attrs, new=False):
    attrs[(None, "rel")] = "nofollow noopener noreferrer"
    return attrs
