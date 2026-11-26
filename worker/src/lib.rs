#[cfg(any(target_arch = "wasm32", test))]
mod cron;
#[cfg(target_arch = "wasm32")]
mod endpoint;
pub mod ingest;
#[cfg(any(target_arch = "wasm32", test))]
mod login;
#[cfg(target_arch = "wasm32")]
mod notify;
#[cfg(target_arch = "wasm32")]
mod slack;

#[cfg(any(target_arch = "wasm32", test))]
mod account;
#[cfg(any(target_arch = "wasm32", test))]
mod limits;
