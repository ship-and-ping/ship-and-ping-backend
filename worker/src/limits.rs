use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct Limits {
    keys: HashMap<String, (String, u64)>,
    apps: HashMap<String, Usage>,
    day: u64,
}
#[derive(Default)]
struct Usage {
    minute: u64,
    recent: u32,
    total: u32,
}
impl Limits {
    pub(crate) fn cached(&self, hash: &str, now: u64) -> Option<String> {
        self.keys
            .get(hash)
            .filter(|(_, expires)| now < *expires)
            .map(|(app, _)| app.clone())
    }
    pub(crate) fn remember(&mut self, hash: &str, app: &str, now: u64) {
        self.keys.retain(|_, (_, expires)| now < *expires);
        self.keys.insert(hash.into(), (app.into(), now + 300));
    }
    pub(crate) fn reserve(&mut self, app: &str, now: u64) -> Result<(), u64> {
        if self.day != now / 86400 {
            self.apps.clear();
            self.day = now / 86400;
        }
        let usage = self.apps.entry(app.into()).or_default();
        if usage.minute != now / 60 {
            usage.minute = now / 60;
            usage.recent = 0;
        }
        if usage.total >= 2000 {
            return Err(86400 - now % 86400);
        }
        if usage.recent >= 20 {
            return Err(60 - now % 60);
        }
        usage.recent += 1;
        usage.total += 1;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lookup_expires_at_five_minutes() {
        let mut state = Limits::default();
        state.remember("hash", "app", 50);
        assert_eq!(state.cached("hash", 349).as_deref(), Some("app"));
        assert_eq!(state.cached("hash", 350), None);
    }
    #[test]
    fn quota_resets_at_utc_boundaries() {
        let mut state = Limits::default();
        for minute in 0..100 {
            for _ in 0..20 {
                assert_eq!(state.reserve("a", minute * 60), Ok(()));
            }
            if minute < 99 {
                assert_eq!(state.reserve("a", minute * 60 + 59), Err(1));
            }
        }
        assert_eq!(state.reserve("a", 6000), Err(80400));
        assert_eq!(state.reserve("b", 6000), Ok(()));
        assert_eq!(state.reserve("a", 86400), Ok(()));
    }
}
