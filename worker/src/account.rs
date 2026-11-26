#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeleteSelf {}

#[cfg(test)]
mod tests {
    use super::DeleteSelf;

    #[test]
    fn delete_self_never_accepts_a_target_or_credentials_from_the_body() {
        assert!(serde_json::from_str::<DeleteSelf>("{}").is_ok());
        for body in [r#"{"id":"other"}"#, r#"{"email":"other"}"#, "null"] {
            assert!(serde_json::from_str::<DeleteSelf>(body).is_err());
        }
    }
}
