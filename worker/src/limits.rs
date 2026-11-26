use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct Limits {
    withdrawals: HashMap<uuid::Uuid, (u64, u8)>,
    keys: HashMap<String, (String, u64)>,
    apps: HashMap<String, Usage>,
    misses: HashMap<String, u64>,
    miss_minute: u64,
    failures: u32,
    pending: u32,
    day: u64,
}
#[derive(Default)]
struct Usage {
    minute: u64,
    recent: u32,
    total: u32,
}
impl Limits {
    pub(crate) fn allow_withdrawal(&mut self, member: uuid::Uuid, now: u64) -> bool {
        self.withdrawals.retain(|_, (until, _)| now < *until);
        let (_, count) = self.withdrawals.entry(member).or_insert((now + 30, 0));
        if *count >= 2 {
            return false;
        }
        *count += 1;
        true
    }
    fn roll_minute(&mut self, now: u64) {
        if self.miss_minute != now / 60 {
            self.miss_minute = now / 60;
            self.failures = 0;
            self.misses.retain(|_, expiry| now < *expiry);
        }
    }
    // Reserve before awaiting the RPC so concurrent cold keys cannot bypass the budget.
    pub(crate) fn begin_lookup(&mut self, hash: &str, now: u64) -> Result<bool, ()> {
        self.roll_minute(now);
        if self.failures + self.pending >= 100 {
            return Err(());
        }
        if self.misses.get(hash).is_some_and(|expiry| now < *expiry) {
            self.failures += 1;
            return Ok(false);
        }
        self.pending += 1;
        Ok(true)
    }
    pub(crate) fn finish_lookup(&mut self, hash: &str, missing: bool, now: u64) {
        self.pending -= 1;
        self.roll_minute(now);
        if missing {
            self.failures += 1;
            self.misses.insert(hash.into(), now + 60);
        }
    }
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
    fn withdrawal_limit_allows_one_immediate_retry_per_member() {
        let mut limits = Limits::default();
        let member = uuid::Uuid::from_u128(1);
        assert!(limits.allow_withdrawal(member, 90));
        assert!(limits.allow_withdrawal(member, 90));
        assert!(!limits.allow_withdrawal(member, 119));
        assert!(limits.allow_withdrawal(uuid::Uuid::from_u128(2), 119));
        assert!(limits.allow_withdrawal(member, 120));
    }
    #[test]
    fn miss_cache_expires_and_concurrent_lookups_share_the_budget() {
        let mut state = Limits::default();
        assert_eq!(state.begin_lookup("missing", 59), Ok(true));
        state.finish_lookup("missing", true, 59);
        for _ in 1..100 {
            assert_eq!(state.begin_lookup("missing", 59), Ok(false));
        }
        assert_eq!(state.begin_lookup("other", 59), Err(()));
        assert_eq!(state.reserve("app", 59), Ok(()));
        assert_eq!(state.begin_lookup("missing", 118), Ok(false));
        assert_eq!(state.begin_lookup("missing", 119), Ok(true));
        for _ in 0..98 {
            assert_eq!(state.begin_lookup("pending", 119), Ok(true));
        }
        assert_eq!(state.begin_lookup("pending", 119), Err(()));
        state.finish_lookup("pending", false, 119);
        assert_eq!(state.begin_lookup("retry", 119), Ok(true));
    }
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
