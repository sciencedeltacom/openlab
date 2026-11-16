"""Checks for openlab_scan: the same expectations the Python twin is tested with.

    mojo test_openlab_scan.mojo
"""

from openlab_scan import bm25_scores, chunk_text, clean_html, rrf, tokenize


def assert_equal(actual: String, expected: String) raises:
    if actual != expected:
        raise Error("expected " + expected + ", got " + actual)


def main() raises:
    # HTML is stripped to text.
    var cleaned = clean_html("<p>Hello <b>world</b></p>")
    assert_equal(cleaned, "Hello world")

    # A long paragraph is windowed into several chunks.
    var long = String()
    for _ in range(2500):
        long += "A"
    var chunks = chunk_text(long)
    if len(chunks) < 2:
        raise Error("a 2500-character paragraph should produce more than one chunk")

    # Tokenization keeps words, drops punctuation, lower-cases.
    var tokens = tokenize("Chromatin accessibility, off-target prediction.")
    assert_equal(tokens[0], "chromatin")
    assert_equal(tokens[1], "accessibility")

    # BM25 ranks the matching document first.
    var documents = List[String]()
    documents.append("chromatin accessibility improves off-target prediction")
    documents.append("unrelated text about battery economics")
    var scores = bm25_scores("chromatin", documents)
    if scores[0] <= scores[1]:
        raise Error("the matching document should score higher")

    # RRF is symmetric for swapped rankings.
    var first = List[String]()
    first.append("x")
    first.append("y")
    var second = List[String]()
    second.append("y")
    second.append("x")
    var rankings = List[List[String]]()
    rankings.append(first.copy())
    rankings.append(second.copy())
    var fused = rrf(rankings)
    if fused["x"] != fused["y"]:
        raise Error("swapped rankings must fuse to the same score")

    print("openlab_scan: all checks passed")
