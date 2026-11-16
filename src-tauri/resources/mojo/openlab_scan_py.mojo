"""The Python extension for openlab_scan.

`mojo build openlab_scan_py.mojo --emit shared-lib -o openlab_scan.so` produces the
module the worker imports as `openlab_scan`. The pure functions live in
`openlab_scan.mojo`; this file is only the Python binding: each wrapper converts
Python values in and a Python list or dict back out.

Build with `./build.sh` (it runs the checks first).
"""

from std.python import Python, PythonObject
from std.python.bindings import PythonModuleBuilder
from std.os import abort

from openlab_scan import (
    bm25_scores as bm25_impl,
    chunk_text as chunk_text_impl,
    clean_html as clean_html_impl,
    rrf as rrf_impl,
    tokenize as tokenize_impl,
)


def py_clean_html(text: PythonObject) raises -> PythonObject:
    return PythonObject(String(clean_html_impl(String(text))))


def py_chunk_text(text: PythonObject, target: PythonObject, overlap: PythonObject) raises -> PythonObject:
    var chunks = chunk_text_impl(String(text), Int(py=target), Int(py=overlap))
    var result = Python.list()
    for chunk in chunks:
        result.append(PythonObject(String(chunk)))
    return result


def py_tokenize(text: PythonObject) raises -> PythonObject:
    var tokens = tokenize_impl(String(text))
    var result = Python.list()
    for token in tokens:
        result.append(PythonObject(String(token)))
    return result


def py_bm25_scores(query: PythonObject, documents: PythonObject) raises -> PythonObject:
    var list = List[String]()
    for index in range(len(documents)):
        list.append(String(documents[index]))
    var scores = bm25_impl(String(query), list)
    var result = Python.list()
    for score in scores:
        result.append(PythonObject(score))
    return result


def py_rrf(rankings: PythonObject, k: PythonObject) raises -> PythonObject:
    var lists = List[List[String]]()
    for index in range(len(rankings)):
        var ranking = rankings[index]
        var inner = List[String]()
        for position in range(len(ranking)):
            inner.append(String(ranking[position]))
        lists.append(inner^)
    var fused = rrf_impl(lists, Int(py=k))
    var result = Python.dict()
    for entry in fused.items():
        result[PythonObject(entry.key)] = PythonObject(entry.value)
    return result


@export
def PyInit_openlab_scan() abi("C") -> PythonObject:
    try:
        var module = PythonModuleBuilder("openlab_scan")
        module.def_function[py_clean_html]("clean_html")
        module.def_function[py_chunk_text]("chunk_text")
        module.def_function[py_tokenize]("tokenize")
        module.def_function[py_bm25_scores]("bm25_scores")
        module.def_function[py_rrf]("rrf")
        return module.finalize()
    except error:
        abort(String("could not build the openlab_scan module: ", error))
