"""BM25 and reciprocal-rank fusion — the retrieval maths, Mojo-first.

Same contract as the Mojo module: `tokenize`, `BM25`, `rrf`. The Python versions
are what run until the Mojo package is compiled into the bundle.
"""

from __future__ import annotations

import math
import re

_WORD = re.compile(r"[a-z0-9][a-z0-9-]{1,}")

K1 = 1.2
B = 0.75
RRF_K = 60


def _mojo():
    try:
        import openlab_scan  # type: ignore

        return openlab_scan
    except Exception:
        return None


def tokenize(text: str) -> list[str]:
    mojo = _mojo()
    if mojo is not None:
        try:
            return list(mojo.tokenize(text.lower()))
        except Exception:
            pass
    return _WORD.findall(text.lower())


class BM25:
    """A small in-memory BM25 over chunks.

    Only the term counts are kept, not the token lists: the counts carry the same information
    for scoring and cost roughly half the memory on a real corpus.
    """

    def __init__(self) -> None:
        self.lengths: dict[str, int] = {}
        self.freqs: dict[str, dict[str, int]] = {}
        self.df: dict[str, int] = {}

    def add(self, doc_id: str, text: str) -> None:
        counts: dict[str, int] = {}
        for token in tokenize(text):
            counts[token] = counts.get(token, 0) + 1
        self.lengths[doc_id] = sum(counts.values())
        self.freqs[doc_id] = counts
        for token in counts:
            self.df[token] = self.df.get(token, 0) + 1

    def scores(self, query: str) -> dict[str, float]:
        terms = tokenize(query)
        if not terms or not self.freqs:
            return {}
        total = len(self.freqs)
        average = sum(self.lengths.values()) / max(1, total)
        scores: dict[str, float] = {}
        for doc_id, counts in self.freqs.items():
            length = self.lengths[doc_id]
            score = 0.0
            for term in terms:
                frequency = counts.get(term, 0)
                if frequency == 0:
                    continue
                idf = math.log(1 + (total - self.df.get(term, 0) + 0.5) / (self.df.get(term, 0) + 0.5))
                score += idf * (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * length / max(1.0, average)))
            if score > 0:
                scores[doc_id] = score
        return scores


def rrf(rankings: list[list[str]], k: int = RRF_K) -> dict[str, float]:
    """Reciprocal-rank fusion over ordered id lists (best first)."""
    mojo = _mojo()
    if mojo is not None:
        try:
            return dict(mojo.rrf(rankings, k))
        except Exception:
            pass
    fused: dict[str, float] = {}
    for ranking in rankings:
        for position, doc_id in enumerate(ranking):
            fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (k + position + 1)
    return fused


def snippet(text: str, query: str, width: int = 220) -> str:
    """The window of `text` around the first query term, for a result row."""
    terms = tokenize(query)
    lowered = text.lower()
    for term in terms:
        at = lowered.find(term)
        if at >= 0:
            start = max(0, at - width // 3)
            end = min(len(text), start + width)
            prefix = "…" if start > 0 else ""
            suffix = "…" if end < len(text) else ""
            return f"{prefix}{text[start:end].strip()}{suffix}"
    return text[:width].strip()
