#[cfg(target_arch = "wasm32")]
mod cron;
#[cfg(target_arch = "wasm32")]
mod endpoint;
pub mod ingest;

#[cfg(any(target_arch = "wasm32", test))]
mod limits;
