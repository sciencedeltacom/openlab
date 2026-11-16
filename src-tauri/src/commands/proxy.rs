//! HTTP proxy for the scientific connectors.
//!
//! The webview cannot reach most research APIs directly — they omit CORS headers or the Tauri
//! webview blocks the cross-origin request — so connector requests are made here. This is a
//! general GET/POST proxy, which makes it an SSRF surface: the host is checked against the
//! obvious internal targets before a request leaves the machine. That is defence in depth
//! rather than a sandbox; the connector plans only ever name public research hosts.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use reqwest::header::{HeaderName, HeaderValue};

use crate::error::CommandError;

/// Response bodies past this size are cut.
const MAX_BYTES: usize = 2 * 1024 * 1024;

/// True for hosts that must never be reached from a research fetch.
pub(crate) fn is_internal(host: &str) -> bool {
    // A trailing dot is the same host to a resolver, so `localhost.` must not slip past the
    // name checks below.
    let name = host
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if name == "localhost"
        || name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".internal")
    {
        return true;
    }
    match name.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                // 100.64.0.0/10 carrier-grade NAT
                || (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
        }
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback()
                || ip.is_unspecified()
                // fc00::/7 unique-local
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                // fe80::/10 link-local
                || (ip.segments()[0] & 0xffc0) == 0xfe80
                // ::ffff:127.0.0.1 and friends arrive as IPv4-mapped addresses.
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4.is_private() || v4.is_link_local())
        }
        Err(_) => false,
    }
}

/// Parse a URL and refuse anything that is not a public http(s) endpoint.
///
/// The one place every outbound request is checked: the proxy, the cloud stores, the agent's
/// own fetch, the OAuth exchange and the scan worker's downloads all route through here, so a
/// new caller cannot forget the internal-host guard.
pub(crate) fn check_public_url(url: &str) -> Result<reqwest::Url, CommandError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| CommandError::invalid(format!("{url} is not a valid URL: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CommandError::invalid(
            "only http and https URLs can be fetched",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if is_internal(host) {
        return Err(CommandError::invalid(format!(
            "{host} is not a public host"
        )));
    }
    Ok(parsed)
}

/// An HTTP client that follows a redirect only to another public host.
///
/// A redirect is how a checked public URL reaches an unchecked internal one: the guard runs on
/// the URL the caller named, and `reqwest` would happily follow a 30x to `169.254.169.254`
/// afterwards. This re-runs the same check on every hop, so a legitimate public redirect (a DOI
/// resolver, a paper landing page) still works while a bounce inward is refused.
pub(crate) fn guarded_client(timeout: Duration) -> Result<reqwest::Client, CommandError> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many redirects");
            }
            if !matches!(attempt.url().scheme(), "http" | "https") {
                return attempt.error("a redirect to a non-http scheme");
            }
            if is_internal(attempt.url().host_str().unwrap_or_default()) {
                return attempt.error("a redirect to an internal host");
            }
            attempt.follow()
        }))
        .build()
        .map_err(|e| CommandError::new("network", format!("could not start an HTTP client: {e}")))
}

/// Cut a body at the cap and mark it.
pub(crate) fn cap(mut text: String) -> String {
    if text.len() > MAX_BYTES {
        let mut end = MAX_BYTES;
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n\n… response truncated");
    }
    text
}

/// Fetch a connector URL and return the response body as text.
#[tauri::command]
pub async fn proxy_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<String, CommandError> {
    let parsed = check_public_url(&url)?;
    let host = parsed.host_str().unwrap_or_default().to_string();

    let client = guarded_client(Duration::from_secs(30))?;

    let http_method = method
        .to_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|_| CommandError::invalid(format!("{method} is not a valid HTTP method")))?;

    let mut request = client.request(http_method, parsed);
    for (name, value) in &headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| CommandError::invalid(format!("{name} is not a valid header name")))?;
        let value = HeaderValue::from_str(value)
            .map_err(|_| CommandError::invalid(format!("{name} has an invalid value")))?;
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| CommandError::new("network", format!("could not reach {host}: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(CommandError::new(
            "network",
            format!("{host} answered {status}"),
        ));
    }
    let text = response.text().await.map_err(|e| {
        CommandError::new(
            "network",
            format!("could not read the response from {host}: {e}"),
        )
    })?;
    Ok(cap(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_hosts_are_refused() {
        assert!(is_internal("localhost"));
        assert!(is_internal("127.0.0.1"));
        assert!(is_internal("10.0.0.5"));
        assert!(is_internal("192.168.1.1"));
        assert!(is_internal("169.254.169.254"));
        assert!(is_internal("index.internal"));
        // A resolver treats the trailing dot as the same name, so the guard must too.
        assert!(is_internal("localhost."));
        assert!(is_internal("127.0.0.1."));
        assert!(is_internal("box.localhost"));
        assert!(!is_internal("eutils.ncbi.nlm.nih.gov"));
        assert!(!is_internal("api.crossref.org"));
    }

    #[test]
    fn only_public_http_urls_pass_the_guard() {
        assert!(check_public_url("https://api.crossref.org/works").is_ok());
        assert!(check_public_url("http://example.org/paper.pdf").is_ok());
        assert!(check_public_url("file:///etc/passwd").is_err());
        assert!(check_public_url("data:text/html,<h1>x</h1>").is_err());
        assert!(check_public_url("not a url").is_err());
        assert!(check_public_url("http://127.0.0.1:8787/admin").is_err());
        assert!(check_public_url("http://169.254.169.254/latest/meta-data").is_err());
    }
}
