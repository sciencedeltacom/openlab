"""openlab_scan — the scan pipeline's hot paths, in Mojo.

The worker imports this module as `openlab_scan` when it is on the path; every
function here has a Python twin in `scanlib` with the same contract, so the
pipeline runs on a machine where Mojo is not installed and gets faster where it is.

Build (from `resources/mojo/`):

    ./build.sh            # compiles the package and runs test_openlab_scan.mojo

The four functions the worker calls are `clean_html`, `chunk_text`, `tokenize`
and `rrf`; `bm25_scores` is here for callers that want the scoring loop in Mojo
too.
"""

from std.math import log

comptime TARGET_CHARS = 900
comptime OVERLAP_CHARS = 150
comptime MIN_CHUNK_CHARS = 40
comptime RRF_K = 60


def is_space(c: Int) -> Bool:
    return c == 32 or c == 9 or c == 10 or c == 13 or c == 12 or c == 11


def clean_html(text: String) -> String:
    """HTML (Surya emits it for tables and maths) to readable plain text."""
    var out = String()
    var in_tag = False
    var last_space = False
    for cp in text.codepoints():
        var c = Int(cp)
        if c == 60:  # '<'
            in_tag = True
            continue
        if c == 62:  # '>'
            in_tag = False
            if not last_space:
                out += " "
                last_space = True
            continue
        if in_tag:
            continue
        if is_space(c):
            if not last_space:
                out += " "
                last_space = True
        else:
            out += chr(c)
            last_space = False
    return String(out.strip())


def chunk_text(text: String, target: Int = TARGET_CHARS, overlap: Int = OVERLAP_CHARS) -> List[String]:
    """Split prose into overlapping windows, preferring paragraph breaks."""
    var chunks = List[String]()
    var current = String()
    for paragraph in text.split("\n\n"):
        var piece = paragraph.strip()
        if piece.byte_length() == 0:
            continue
        if current.byte_length() > 0 and current.byte_length() + piece.byte_length() + 2 > target:
            chunks.append(current)
            var tail = String()
            if overlap > 0 and current.byte_length() > overlap:
                tail = String(current[byte=current.byte_length() - overlap :])
            current = tail + "\n\n" + piece
        else:
            if current.byte_length() > 0:
                current += "\n\n"
            current += piece
    if current.byte_length() > 0:
        chunks.append(current)

    var sized = List[String]()
    for chunk in chunks:
        if chunk.byte_length() <= target * 2:
            if chunk.byte_length() >= MIN_CHUNK_CHARS:
                sized.append(chunk)
            continue
        var start = 0
        while start < chunk.byte_length():
            var end = start + target
            if end > chunk.byte_length():
                end = chunk.byte_length()
            var piece = chunk[byte=start:end]
            if piece.byte_length() >= MIN_CHUNK_CHARS:
                sized.append(String(piece))
            start += target - overlap
    return sized^


def tokenize(text: String) -> List[String]:
    """Lower-case word tokens of two or more characters."""
    var tokens = List[String]()
    var current = String()
    for cp in text.lower().codepoints():
        var c = Int(cp)
        var keep = (c >= 97 and c <= 122) or (c >= 48 and c <= 57) or c == 45
        if keep:
            current += chr(c)
        else:
            if current.byte_length() >= 2:
                tokens.append(current)
            current = String()
    if current.byte_length() >= 2:
        tokens.append(current)
    return tokens^


def bm25_scores(
    query: String, documents: List[String], k1: Float64 = 1.2, b: Float64 = 0.75
) -> List[Float64]:
    """BM25 score per document, in the order given."""
    var total = len(documents)
    var lengths = List[Int]()
    var freqs = List[Dict[String, Int]]()
    var df = Dict[String, Int]()
    var average = 0.0
    for document in documents:
        var tokens = tokenize(document)
        lengths.append(len(tokens))
        average += Float64(len(tokens))
        var counts = Dict[String, Int]()
        for token in tokens:
            counts[token] = counts.get(token, 0) + 1
        freqs.append(counts.copy())
        for token in counts:
            df[token] = df.get(token, 0) + 1
    if total > 0:
        average /= Float64(total)

    var terms = tokenize(query)
    var scores = List[Float64]()
    for index in range(total):
        var score = 0.0
        var length = Float64(lengths[index])
        for term in terms:
            var frequency = freqs[index].get(term, 0)
            if frequency == 0:
                continue
            var dfi = Float64(df.get(term, 0))
            var idf = log(1.0 + (Float64(total) - dfi + 0.5) / (dfi + 0.5))
            var norm = 1.0 - b + b * length / max(1.0, average)
            score += idf * Float64(frequency) * (k1 + 1.0) / (Float64(frequency) + k1 * norm)
        scores.append(score)
    return scores^


def rrf(rankings: List[List[String]], k: Int = RRF_K) -> Dict[String, Float64]:
    """Reciprocal-rank fusion over ordered id lists (best first)."""
    var fused = Dict[String, Float64]()
    for ranking in rankings:
        for position in range(len(ranking)):
            var doc_id = ranking[position]
            var prior = fused.get(doc_id, 0.0)
            fused[doc_id] = prior + 1.0 / Float64(k + position + 1)
    return fused^
