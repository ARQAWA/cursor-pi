# ReadFile  (S3, first seen in request 55, call_id call_626d5c60656b40f48f3cf05df1e15af8, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/main.rs"}
```

## Output

```
use std::{fs::OpenOptions, process::ExitCode};

use anyhow::{Context, Result};
use superbot_auth::Settings;
use superbot_observability::{FailureContext, Observer, init_sentry};
use tokio::signal::unix::{SignalKind, signal};
use tokio_util::sync::CancellationToken;

use superbot_wallet_sync::{config::WalletConfig, daemon::WalletDaemon};
    10|
const ALREADY_RUNNING_EXIT_CODE: u8 = 75;

#[tokio::main]
async fn main() -> ExitCode {
    let _sentry = Settings::load_sentry("config.toml")
        .ok()
        .map(|settings| init_sentry(&settings.dsn, &settings.environment));
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
    20|        Err(error) if error.to_string() == "wallet sync is already running" => {
            eprintln!("WalletSync|already_running");
            ExitCode::from(ALREADY_RUNNING_EXIT_CODE)
        }
        Err(error) => {
            let code = startup_failure_code(&error);
            capture_startup_failure(code, &error);
            eprintln!("WalletSync|failed|code={code}");
            ExitCode::FAILURE
        }
    30|    }
}

async fn run() -> Result<()> {
    let settings = Settings::load("config.toml").context("load full runtime configuration")?;
    let wallet = WalletConfig::load("config.toml").context("load wallet configuration")?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
    40|        .write(true)
        .open(&wallet.wallet_sync.lock_file)
        .context("open wallet lock")?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| anyhow::anyhow!("wallet sync is already running"))?;
    let daemon = WalletDaemon::connect(&settings, wallet).await?;
    let cancel = CancellationToken::new();
    let signal_cancel = cancel.clone();
    let mut terminate = signal(SignalKind::terminate()).context("listen for SIGTERM")?;
    tokio::spawn(async move {
    50|        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
        signal_cancel.cancel();
    });
    daemon.run(cancel).await
}
fn startup_failure_code(error: &anyhow::Error) -> &'static str {
    for source in error.chain() {
        match source.to_string().as_str() {
            "load full runtime configuration" | "load wallet configuration" => {
                return "config_invalid";
    60|            }
            "open wallet lock" => return "lock_open_failed",
            "connect wallet PostgreSQL" => return "postgres_connect_failed",
            "listen for SIGTERM" => return "signal_listener_failed",
            _ => {}
        }
    }
    "runtime_failed"
}
fn capture_startup_failure(code: &str, error: &anyhow::Error) {
    70|    let phase = if code == "runtime_failed" {
        "runtime"
    } else {
        "startup"
    };
    Observer::sentry().capture(FailureContext::new(
        "wallet_sync",
        phase,
        "service_exit",
        "__service__",
    80|        "WalletRuntimeError",
        code,
        error.to_string(),
        "exit_for_container_restart",
        None,
        1,
        "runtime",
    ));
}

```
