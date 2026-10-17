# ReadFile  (S3, first seen in request 12, call_id call_fd60c2514cf74a70bbd5ba28090badd6, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/daemon.rs"}
```

## Output

```
use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, Utc};
use futures::{StreamExt, stream};
use redis::aio::ConnectionManager;
use superbot_auth::{AuthCache, Settings};
use superbot_observability::{FailureContext, Observer};
use tokio::sync::Mutex;
    10|use tokio_util::sync::CancellationToken;

use crate::{
    config::WalletConfig,
    kafka::WalletKafkaWriter,
    model::{WalletEvent, parse_wallet_addfunds_page},
    session::{WalletFetchError, WalletProxyLocks, WalletSessions, fetch_wallet},
    store::WalletStore,
};

    20|pub struct WalletDaemon {
    config: WalletConfig,
    store: WalletStore,
    auth_cache: AuthCache,
    cooldown_cache: ConnectionManager,
    writer: WalletKafkaWriter,
    locks: WalletProxyLocks,
    sessions: Mutex<WalletSessions>,
    observer: Observer,
}
    30|impl WalletDaemon {
    pub async fn connect(settings: &Settings, config: WalletConfig) -> Result<Self> {
        let store = WalletStore::connect(settings).await?;
        let auth_cache = AuthCache::connect(&settings.redis.url).await?;
        let client = redis::Client::open(settings.redis.url.as_str())?;
        let cooldown_cache = client.get_connection_manager().await?;
        let writer = WalletKafkaWriter::new(
            &config.clickhouse_injector.bootstrap_servers,
            &config.clickhouse_injector.group_id,
            config.wallet_sync.kafka_payload_max_bytes,
    40|        )?;
        Ok(Self {
            config,
            store,
            auth_cache,
            cooldown_cache,
            writer,
            locks: WalletProxyLocks::default(),
            sessions: Mutex::new(WalletSessions::default()),
            observer: Observer::sentry(),
    50|        })
    }
    pub async fn run(&self, cancel: CancellationToken) -> Result<()> {
        self.store.mark_unfinished_failed().await?;
        loop {
            if cancel.is_cancelled() {
                break;
            }
            self.flush_pending(&cancel).await?;
            self.store
    60|                .complete_ready_iterations(self.config.wallet_sync.interval_seconds)
                .await?;
            let now = Utc::now();
            match self.load_work(now).await? {
                Some((kind, logins)) => self.run_iteration(kind, logins, now, &cancel).await?,
                None => {
                    if self.sleep_to_next(&cancel).await? {
                        break;
                    }
                }
    70|            }
        }
        self.writer.flush()?;
        Ok(())
    }
    async fn load_work(&self, now: DateTime<Utc>) -> Result<Option<(&'static str, Vec<String>)>> {
        let full_at = self.store.next_full_at().await?;
        if full_at.is_none_or(|value| value <= now) {
            let logins = self.store.active_logins().await?;
            self.store.sync_roster(&logins, now).await?;
    80|            return Ok(Some(("full", logins)));
        }
        let logins = self.store.due_retry_logins(now).await?;
        Ok((!logins.is_empty()).then_some(("retry", logins)))
    }
    async fn sleep_to_next(&self, cancel: &CancellationToken) -> Result<bool> {
        let full = self.store.next_full_at().await?;
        let retry = self.store.earliest_retry_at().await?;
        let next = match (full, retry) {
            (Some(a), Some(b)) => Some(a.min(b)),
    90|            (Some(value), None) | (None, Some(value)) => Some(value),
            (None, None) => None,
        };
        let Some(next) = next else {
            return Ok(false);
        };
        let seconds = (next - Utc::now()).num_milliseconds().max(0) as u64;
        if seconds == 0 {
            return Ok(false);
        }
   100|        Ok(
            tokio::select! { () = tokio::time::sleep(Duration::from_millis(seconds)) => false, () = cancel.cancelled() => true },
        )
    }
    async fn flush_pending(&self, cancel: &CancellationToken) -> Result<()> {
        let run_id = Utc::now().timestamp();
        let mut page = 1usize;
        loop {
            let events = self.store.pending_events().await?;
            if events.is_empty() {
   110|                return Ok(());
            }
            self.writer
                .send_and_wait(
                    &events,
                    &format!("wallet-pending-{run_id}-p{page:06}"),
                    cancel,
                )
                .await?;
            self.store.mark_stats_synced(&events).await?;
   120|            page += 1;
        }
    }
    async fn run_iteration(
        &self,
        kind: &'static str,
        logins: Vec<String>,
        now: DateTime<Utc>,
        cancel: &CancellationToken,
    ) -> Result<()> {
   130|        if kind == "full" {
            self.sessions.lock().await.prune(&logins);
        }
        let iteration = self.store.begin_iteration(kind, logins.len(), now).await?;
        eprintln!(
            "WalletSync|iteration_start|kind={kind}|iteration={iteration}|logins={}",
            logins.len()
        );
        let mut results = stream::iter(
            logins
   140|                .into_iter()
                .enumerate()
                .map(|(index, login)| async move {
                    (index, self.sync_one(&login, iteration, now, cancel).await)
                }),
        )
        .buffer_unordered(self.config.wallet_sync.concurrency)
        .collect::<Vec<_>>()
        .await;
        results.sort_by_key(|(index, _)| *index);
   150|        let events: Vec<WalletEvent> = results
            .into_iter()
            .map(|(_, value)| value)
            .collect::<Result<Vec<Option<WalletEvent>>>>()?
            .into_iter()
            .flatten()
            .collect();
        if cancel.is_cancelled() {
            anyhow::bail!("wallet shutdown requested");
        }
   160|        self.writer
            .send_and_wait(&events, &format!("wallet-{iteration}"), cancel)
            .await?;
        self.store.mark_stats_synced(&events).await?;
        self.store
            .complete_iteration(iteration, self.config.wallet_sync.interval_seconds)
            .await?;
        eprintln!(
            "WalletSync|iteration_done|kind={kind}|iteration={iteration}|events={}",
            events.len()
   170|        );
        Ok(())
    }
    async fn sync_one(
        &self,
        login: &str,
        iteration: i64,
        bucket_at: DateTime<Utc>,
        cancel: &CancellationToken,
    ) -> Result<Option<WalletEvent>> {
   180|        if cancel.is_cancelled() {
            anyhow::bail!("wallet shutdown requested");
        }
        let payload = match self.auth_cache.payload(login).await? {
            Some(payload) => payload,
            None => {
                return self
                    .failed(
                        login,
                        iteration,
   190|                        self.config.wallet_sync.failure_retry_seconds,
                        failure_context(
                            "auth_readiness",
                            "load_live_auth",
                            login,
                            "WalletAuthReadinessError",
                            "auth_missing",
                            "Redis auth payload is missing",
                            "retry",
                            Some(self.config.wallet_sync.failure_retry_seconds),
   200|                            "redis_auth",
                            "NoProxy",
                        ),
                    )
                    .await
                    .map(|_| None);
            }
        };
        let session = match self.sessions.lock().await.resolve(payload) {
            Ok(session) => session,
   210|            Err(error) => {
                return self
                    .failed(
                        login,
                        iteration,
                        self.config.wallet_sync.failure_retry_seconds,
                        failure_context(
                            "auth_readiness",
                            "build_wallet_session",
                            login,
   220|                            "WalletAuthReadinessError",
                            "auth_invalid",
                            error.to_string(),
                            "retry",
                            Some(self.config.wallet_sync.failure_retry_seconds),
                            "redis_auth",
                            "NoProxy",
                        ),
                    )
                    .await
   230|                    .map(|_| None);
            }
        };
        let observed_at = Utc::now();
        let page = match fetch_wallet(
            &session,
            &self.cooldown_cache,
            &self.config.wallet_sync,
            &self.locks,
            cancel,
   240|        )
        .await
        {
            Ok(page) => page,
            Err(WalletFetchError::Cancelled) => anyhow::bail!("wallet shutdown requested"),
            Err(WalletFetchError::RateLimited {
                origin,
                retry_delay_seconds,
            }) => {
                return self
   250|                    .failed(
                        login,
                        iteration,
                        retry_delay_seconds,
                        failure_context(
                            "fetch",
                            "wallet_addfunds_request",
                            login,
                            "SteamRateLimited",
                            "rate_limited",
   260|                            "Steam rate limit is active",
                            "retry",
                            Some(retry_delay_seconds),
                            "steam_addfunds",
                            session.proxy_key(),
                        )
                        .with_tag("rate_limit_origin", origin),
                    )
                    .await
                    .map(|_| None);
   270|            }
            Err(WalletFetchError::Transport { source }) => {
                let context = failure_context(
                    "fetch",
                    "wallet_addfunds_request",
                    login,
                    "WalletTransportError",
                    "network",
                    "Steam addfunds request send failed",
                    "retry",
   280|                    Some(self.config.wallet_sync.failure_retry_seconds),
                    "steam_addfunds",
                    session.proxy_key(),
                )
                .with_evidence("request_host", "store.steampowered.com")
                .with_evidence("request_phase", "send")
                .with_evidence("is_connect", source.is_connect())
                .with_evidence("is_timeout", source.is_timeout())
                .with_evidence("is_request", source.is_request())
                .with_evidence("is_body", source.is_body());
   290|                let source = anyhow::Error::new(source);
                return self
                    .failed_with_error(
                        login,
                        iteration,
                        self.config.wallet_sync.failure_retry_seconds,
                        context,
                        &source,
                    )
                    .await
   300|                    .map(|_| None);
            }
            Err(WalletFetchError::Response { code }) => {
                return self
                    .failed(
                        login,
                        iteration,
                        self.config.wallet_sync.failure_retry_seconds,
                        failure_context(
                            "fetch",
   310|                            "wallet_addfunds_request",
                            login,
                            "WalletResponseError",
                            &code,
                            &code,
                            "retry",
                            Some(self.config.wallet_sync.failure_retry_seconds),
                            "steam_addfunds",
                            session.proxy_key(),
                        ),
   320|                    )
                    .await
                    .map(|_| None);
            }
        };
        let wallet_minor =
            match parse_wallet_addfunds_page(&page, &self.config.wallet_sync.currency_code) {
                Ok(value) => value,
                Err(error) => {
                    return self
   330|                        .failed(
                            login,
                            iteration,
                            self.config.wallet_sync.failure_retry_seconds,
                            failure_context(
                                "parse",
                                "wallet_addfunds_page",
                                login,
                                "WalletParseError",
                                "parse_error",
   340|                                error.to_string(),
                                "retry",
                                Some(self.config.wallet_sync.failure_retry_seconds),
                                "steam_addfunds",
                                session.proxy_key(),
                            ),
                        )
                        .await
                        .map(|_| None);
                }
   350|            };
        let event = WalletEvent {
            bucket_at,
            observed_at,
            login: login.to_owned(),
            wallet_minor,
            currency_id: self.config.wallet_sync.currency_id,
            iteration_id: iteration,
        };
        self.store
   360|            .record_success(
                &event,
                observed_at
                    + chrono::Duration::seconds(self.config.wallet_sync.interval_seconds as i64),
            )
            .await?;
        Ok(Some(event))
    }
    async fn failed(
        &self,
   370|        login: &str,
        iteration: i64,
        retry: u64,
        context: FailureContext,
    ) -> Result<()> {
        let code = context.error_code.clone();
        self.observe(context);
        self.store
            .record_failure(login, iteration, retry, &code)
            .await?;
   380|        Ok(())
    }

    async fn failed_with_error(
        &self,
        login: &str,
        iteration: i64,
        retry: u64,
        context: FailureContext,
        error: &anyhow::Error,
   390|    ) -> Result<()> {
        let code = context.error_code.clone();
        self.observe_error(context, error);
        self.store
            .record_failure(login, iteration, retry, &code)
            .await?;
        Ok(())
    }

    fn observe(&self, context: FailureContext) {
   400|        let event_id = self.observer.capture(context.clone());
        eprintln!(
            "WalletSync|failure|phase={}|operation={}|identity={}|error_type={}|error_code={}|recovery_action={}|event_id={}",
            context.phase,
            context.operation,
            context.identity,
            context.error_type,
            context.error_code,
            context.recovery_action,
            event_id,
   410|        );
    }

    fn observe_error(&self, context: FailureContext, error: &anyhow::Error) {
        let event_id = self.observer.capture_error(context.clone(), error);
        eprintln!(
            "WalletSync|failure|phase={}|operation={}|identity={}|error_type={}|error_code={}|recovery_action={}|event_id={}",
            context.phase,
            context.operation,
            context.identity,
   420|            context.error_type,
            context.error_code,
            context.recovery_action,
            event_id,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn failure_context(
   430|    phase: &'static str,
    operation: &'static str,
    identity: &str,
    error_type: impl AsRef<str>,
    error_code: impl AsRef<str>,
    error_detail: impl AsRef<str>,
    recovery_action: &'static str,
    retry_delay_seconds: Option<u64>,
    infrastructure_key: &'static str,
    proxy_key: &str,
   440|) -> FailureContext {
    FailureContext::new(
        "wallet_sync",
        phase,
        operation,
        identity,
        error_type,
        error_code,
        error_detail,
        recovery_action,
   450|        retry_delay_seconds,
        1,
        infrastructure_key,
    )
    .with_tag("proxy_key", proxy_key)
}

#[cfg(test)]
mod tests {
    use super::failure_context;
   460|
    #[test]
    fn controlled_auth_missing_has_immediate_context() {
        let context = failure_context(
            "auth_readiness",
            "load_live_auth",
            "account",
            "WalletAuthReadinessError",
            "auth_missing",
            "Redis auth payload is missing",
   470|            "retry",
            Some(60),
            "redis_auth",
            "NoProxy",
        );
        assert_eq!(context.component, "wallet_sync");
        assert_eq!(context.error_code, "auth_missing");
        assert_eq!(context.retry_delay_seconds, Some(60));
        assert_eq!(
            context.tags.get("proxy_key").map(String::as_str),
   480|            Some("NoProxy")
        );
    }
}

```
