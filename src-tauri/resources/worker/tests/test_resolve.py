"""The URL guard in the scan worker.

Run from `src-tauri/resources/worker`:

    python3 -m unittest discover -s tests
"""

import unittest

from scanlib.resolve import UnsafeUrl, _safe_url


class SafeUrlTest(unittest.TestCase):
    def test_a_public_https_url_is_allowed(self):
        self.assertEqual(_safe_url("https://example.org/paper.pdf"), "https://example.org/paper.pdf")

    def test_a_file_url_is_refused(self):
        with self.assertRaises(UnsafeUrl):
            _safe_url("file:///etc/passwd")

    def test_loopback_and_private_addresses_are_refused(self):
        for url in (
            "http://127.0.0.1/paper.pdf",
            "http://localhost/paper.pdf",
            "http://10.0.0.4/paper.pdf",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/paper.pdf",
        ):
            with self.assertRaises(UnsafeUrl, msg=url):
                _safe_url(url)

    def test_a_non_web_port_is_refused(self):
        with self.assertRaises(UnsafeUrl):
            _safe_url("http://example.org:8080/paper.pdf")

    def test_a_missing_host_is_refused(self):
        with self.assertRaises(UnsafeUrl):
            _safe_url("https:///paper.pdf")


if __name__ == "__main__":
    unittest.main()
