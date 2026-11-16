"""Embeddings: EmbeddingGemma 2 over llama.cpp, with a degraded fallback.

The real path posts to the llama-server the app runs with the GGUF model. EmbeddingGemma 2
is a retrieval model: queries and documents carry different task prefixes, and the model card
is explicit that they must be added by the caller — a query embedded as if it were a document
loses most of its recall. Both sides are prefixed here.

When the server is not up — a machine that has not downloaded the model yet, or a test — the
fallback hashes tokens into a fixed vector. It is deterministic and keeps the pipeline
exercisable, but the health report says `fallback` so nobody mistakes it for a semantic
embedding.
"""

from __future__ import annotations

import hashlib
import json
import math
import urllib.request

from .bm25 import tokenize

DIM = 256

# From the EmbeddingGemma 2 model card: queries and documents are prefixed differently.
QUERY_TEMPLATE = "task: search result | query: {text}"
DOCUMENT_TEMPLATE = "title: none | text: {text}"


def prompt_for(text: str, kind: str) -> str:
    template = QUERY_TEMPLATE if kind == "query" else DOCUMENT_TEMPLATE
    return template.format(text=text)


def embed_texts(config, texts: list[str], kind: str = "document") -> tuple[list[list[float]], str]:
    """Vectors for `texts`, and which engine produced them. `kind` is query or document."""
    if config.embedder() == "llama.cpp":
        try:
            prompts = [prompt_for(text, kind) for text in texts]
            return _server_embeddings(config, prompts), "llama.cpp"
        except Exception:
            pass
    return [hashed_embedding(text) for text in texts], "fallback"


def _server_embeddings(config, texts: list[str]) -> list[list[float]]:
    payload = json.dumps({"model": config.embed_model, "input": texts}).encode("utf-8")
    request = urllib.request.Request(
        f"{config.embed_url}/v1/embeddings",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = json.loads(response.read().decode("utf-8"))
    rows = sorted(body["data"], key=lambda row: row.get("index", 0))
    return [row["embedding"] for row in rows]


def hashed_embedding(text: str, dim: int = DIM) -> list[float]:
    """Deterministic token-hash embedding, L2-normalised. Test/degraded mode."""
    vector = [0.0] * dim
    for token in tokenize(text):
        digest = hashlib.sha1(token.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % dim
        vector[bucket] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))
