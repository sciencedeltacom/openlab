"""Finding and downloading the PDF.

A record is metadata; the file lives at an open-access location the metadata points
at. OpenAlex answers with the best OA copy for a DOI or a work id, and a record
that already carries a direct PDF URL needs no lookup. Paywalled records are
reported, not guessed at.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import socket
import urllib.parse
import urllib.request
from pathlib import Path

OPENALEX = "https://api.openalex.org"
USER_AGENT = "openlab/1.0 (research workbench; scan)"
MAX_BYTES = 30 * 1024 * 1024


class NoPdfFound(RuntimeError):
    """No open-access PDF is known for the record."""


class UnsafeUrl(ValueError):
    """A URL points somewhere the worker will not fetch from."""


def _safe_url(url: str) -> str:
    """Parse a URL and refuse anything that is not a public http(s) endpoint.

    Metadata is input from the internet: a DOI's `pdf_url` can be `file:///etc/passwd`, a
    loopback service, or a redirect inward. The check runs on the URL the metadata names and
    again on every redirect, so a public URL that bounces to 127.0.0.1 is refused too.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrl(f"{url} is not an http(s) URL")
    host = parsed.hostname
    if not host:
        raise UnsafeUrl(f"{url} has no host")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in (80, 443):
        raise UnsafeUrl(f"{url} uses port {port}; only 80 and 443 are fetched")
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)}
    except OSError as error:
        raise UnsafeUrl(f"could not resolve {host}: {error}") from error
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError as error:
            raise UnsafeUrl(f"{host} resolved to an unreadable address") from error
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise UnsafeUrl(f"{host} is not a public host")
    return url


class _SafeRedirects(urllib.request.HTTPRedirectHandler):
    """Re-validate every redirect, since urllib follows them by default."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(url: str, headers: dict[str, str], timeout: int):
    _safe_url(url)
    opener = urllib.request.build_opener(_SafeRedirects)
    request = urllib.request.Request(url, headers=headers)
    return opener.open(request, timeout=timeout)


def _get_json(url: str) -> dict:
    with _open(url, {"User-Agent": USER_AGENT, "Accept": "application/json"}, 30) as response:
        return json.loads(response.read().decode("utf-8"))


def resolve_pdf_url(config, doi: str | None = None, record_id: str | None = None, url: str | None = None) -> str:
    """The OA PDF URL for a record, or `NoPdfFound`."""
    if url and url.lower().endswith(".pdf"):
        return url

    work: dict | None = None
    try:
        if record_id and record_id.upper().startswith("W"):
            work = _get_json(f"{OPENALEX}/works/{urllib.parse.quote(record_id)}")
        elif doi:
            work = _get_json(f"{OPENALEX}/works/https://doi.org/{urllib.parse.quote(doi)}")
        elif record_id:
            work = _get_json(f"{OPENALEX}/works/{urllib.parse.quote(record_id)}")
    except Exception:
        work = None

    if work:
        for candidate in (
            (work.get("best_oa_location") or {}).get("pdf_url"),
            (work.get("open_access") or {}).get("oa_url"),
            *[(location or {}).get("pdf_url") for location in work.get("locations", [])],
        ):
            if candidate:
                return _safe_url(candidate)

    raise NoPdfFound("no open-access PDF is known for this record")


def download(config, url: str, name: str) -> tuple[Path, str, int]:
    """Stream a PDF to the index directory; returns path, sha256 and size."""
    config.ensure()
    digest = hashlib.sha256()
    size = 0
    destination = config.pdf_dir / f"{name}.pdf"
    with _open(url, {"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"}, 120) as response, destination.open("wb") as handle:
        while True:
            block = response.read(256 * 1024)
            if not block:
                break
            size += len(block)
            if size > MAX_BYTES:
                handle.close()
                destination.unlink(missing_ok=True)
                raise RuntimeError(f"the PDF is larger than {MAX_BYTES // (1024 * 1024)} MB")
            digest.update(block)
            handle.write(block)
    return destination, digest.hexdigest(), size
