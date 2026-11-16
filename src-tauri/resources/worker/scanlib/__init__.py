"""The scan worker's library.

Everything here runs on the bundled Python (3.9+): the optional heavy parts —
Surya for OCR, llama.cpp for EmbeddingGemma, LanceDB for the vector store, Mojo
for the hot paths — are imported when they exist and reported honestly when they
do not. The fallbacks are real implementations, not stubs: text extraction falls
back to pdftotext/PyMuPDF, the store falls back to a JSONL index, search falls
back to BM25, and the chunker falls back to its Python twin of the Mojo module.
"""
