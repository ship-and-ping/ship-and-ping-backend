pub(crate) fn browser(agent: &str) -> &'static str {
    for (marker, name) in [
        ("Edg", "Edge"),
        ("Firefox", "Firefox"),
        ("Chrome", "Chrome"),
        ("Safari", "Safari"),
    ] {
        if agent.contains(marker) {
            return name;
        }
    }
    "기타 브라우저"
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_known_browser_names_leave_the_worker() {
        assert_eq!(super::browser("Chrome/1 Edg/1"), "Edge");
        assert_eq!(super::browser("sensitive personal value"), "기타 브라우저");
    }
}
