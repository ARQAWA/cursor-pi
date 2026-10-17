# ReadFile  (S3, first seen in request 16, call_id call_dc75e7f15c2d47e69cf3fd5d0a4a9ee8, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/store.rs"}
```

## Output

```
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use sqlx::{
    PgPool, Row,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use superbot_auth::Settings;

use crate::model::WalletEvent;
    10|
pub struct WalletStore {
    pool: PgPool,
}
impl WalletStore {
    pub async fn connect(settings: &Settings) -> Result<Self> {
        let options = PgConnectOptions::new()
            .host(&settings.postgres.host)
            .port(settings.postgres.port)
            .database(&settings.postgres.database)
    20|            .username(&settings.postgres.username)
            .password(&settings.postgres.password);
        let pool = PgPoolOptions::new()
            .min_connections(settings.postgres.min_connections)
            .max_connections(settings.postgres.max_connections)
            .connect_with(options)
            .await
            .context("connect wallet PostgreSQL")?;
        Ok(Self { pool })
    }
    30|    pub async fn active_logins(&self) -> Result<Vec<String>> {
        Ok(sqlx::query("SELECT login FROM auth.credentials WHERE active = TRUE AND runtime_role = 'trading' ORDER BY login").fetch_all(&self.pool).await?.into_iter().map(|row| row.try_get("login")).collect::<std::result::Result<_, _>>()?)
    }
    pub async fn mark_unfinished_failed(&self) -> Result<()> {
        sqlx::query("UPDATE wallet_sync_iterations SET status = 'failed', completed_at = COALESCE(completed_at, now()), last_error = $1 WHERE status = 'running'").bind("wallet daemon restarted").execute(&self.pool).await?;
        Ok(())
    }
    pub async fn next_full_at(&self) -> Result<Option<DateTime<Utc>>> {
        Ok(sqlx::query_scalar("SELECT next_run_at FROM wallet_sync_iterations WHERE status = 'completed' AND kind = 'full' ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT 1").fetch_optional(&self.pool).await?)
    }
    40|    pub async fn earliest_retry_at(&self) -> Result<Option<DateTime<Utc>>> {
        Ok(sqlx::query_scalar("SELECT min(next_attempt_at) FROM wallet_sync_state WHERE active = TRUE AND last_error IS NOT NULL").fetch_one(&self.pool).await?)
    }
    pub async fn due_retry_logins(&self, now: DateTime<Utc>) -> Result<Vec<String>> {
        Ok(sqlx::query("SELECT login FROM wallet_sync_state WHERE active = TRUE AND last_error IS NOT NULL AND next_attempt_at <= $1 ORDER BY next_attempt_at, login LIMIT 1000").bind(now).fetch_all(&self.pool).await?.into_iter().map(|row| row.try_get("login")).collect::<std::result::Result<_, _>>()?)
    }
    pub async fn sync_roster(&self, logins: &[String], now: DateTime<Utc>) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        if !logins.is_empty() {
            sqlx::query("INSERT INTO wallet_sync_state (login, active, roster_seen_at, next_attempt_at, updated_at) SELECT DISTINCT login, TRUE, $2::timestamptz, $2::timestamptz, $2::timestamptz FROM unnest($1::text[]) AS item(login) ON CONFLICT (login) DO UPDATE SET active = TRUE, roster_seen_at = EXCLUDED.roster_seen_at, updated_at = EXCLUDED.updated_at").bind(logins).bind(now).execute(&mut *tx).await?;
    50|        }
        sqlx::query("UPDATE wallet_sync_state SET active = FALSE, updated_at = $1 WHERE roster_seen_at < $1").bind(now).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn begin_iteration(
        &self,
        kind: &str,
        count: usize,
        now: DateTime<Utc>,
    60|    ) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO wallet_sync_iterations (started_at, status, expected_count, processed_count, success_count, failed_count, kind) VALUES ($1, 'running', $2, 0, 0, 0, $3) RETURNING id").bind(now).bind(count as i32).bind(kind).fetch_one(&self.pool).await?)
    }
    pub async fn record_success(
        &self,
        event: &WalletEvent,
        next_attempt_at: DateTime<Utc>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE wallet_sync_state SET wallet_minor = $2, currency_id = $3, last_success_at = $4, next_attempt_at = $5, retry_count = 0, last_error = NULL, updated_at = $4, iteration_id = $6, stats_bucket_at = $7, stats_observed_at = $4, stats_synced_at = NULL WHERE login = $1").bind(&event.login).bind(event.wallet_minor).bind(event.currency_id).bind(event.observed_at).bind(next_attempt_at).bind(event.iteration_id).bind(event.bucket_at).execute(&mut *tx).await?;
    70|        sqlx::query("UPDATE wallet_sync_iterations SET processed_count = processed_count + 1, success_count = success_count + 1 WHERE id = $1").bind(event.iteration_id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn record_failure(
        &self,
        login: &str,
        iteration_id: i64,
        retry_seconds: u64,
        code: &str,
    80|    ) -> Result<i32> {
        let now = Utc::now();
        let next = now + Duration::seconds(retry_seconds.max(1) as i64);
        let mut tx = self.pool.begin().await?;
        let retry: Option<i32> = sqlx::query_scalar("UPDATE wallet_sync_state SET next_attempt_at = $2, retry_count = retry_count + 1, last_error = $3, updated_at = $4 WHERE login = $1 RETURNING retry_count").bind(login).bind(next).bind(code).bind(now).fetch_optional(&mut *tx).await?;
        let retry = retry.context("wallet sync state missing")?;
        sqlx::query("UPDATE wallet_sync_iterations SET processed_count = processed_count + 1, failed_count = failed_count + 1, last_error = COALESCE(last_error, $2) WHERE id = $1").bind(iteration_id).bind(code).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(retry)
    }
    90|    pub async fn pending_events(&self) -> Result<Vec<WalletEvent>> {
        let rows = sqlx::query("SELECT login, wallet_minor, currency_id, iteration_id, stats_bucket_at, stats_observed_at FROM wallet_sync_state WHERE stats_synced_at IS NULL AND stats_observed_at IS NOT NULL AND stats_bucket_at IS NOT NULL AND wallet_minor IS NOT NULL AND currency_id IS NOT NULL AND iteration_id IS NOT NULL ORDER BY iteration_id, login LIMIT 1000").fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(WalletEvent {
                    bucket_at: row.try_get("stats_bucket_at")?,
                    observed_at: row.try_get("stats_observed_at")?,
                    login: row.try_get("login")?,
                    wallet_minor: row.try_get("wallet_minor")?,
                    currency_id: row.try_get("currency_id")?,
   100|                    iteration_id: row.try_get("iteration_id")?,
                })
            })
            .collect()
    }
    pub async fn mark_stats_synced(&self, events: &[WalletEvent]) -> Result<()> {
        let pairs: Vec<_> = events
            .iter()
            .map(|event| (event.login.clone(), event.iteration_id))
            .collect();
   110|        if pairs.is_empty() {
            return Ok(());
        }
        let now = Utc::now();
        let (logins, iterations): (Vec<_>, Vec<_>) = pairs.into_iter().unzip();
        sqlx::query("UPDATE wallet_sync_state AS state SET stats_synced_at = $3, updated_at = $3 FROM unnest($1::text[], $2::bigint[]) AS synced(login, iteration_id) WHERE state.login = synced.login AND state.iteration_id = synced.iteration_id AND state.stats_synced_at IS NULL").bind(logins).bind(iterations).bind(now).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn complete_iteration(&self, iteration_id: i64, interval_seconds: u64) -> Result<()> {
        let now = Utc::now();
   120|        let next = now + Duration::seconds(interval_seconds.max(1) as i64);
        sqlx::query("UPDATE wallet_sync_iterations SET status = 'completed', completed_at = $2, stats_synced_at = $2, next_run_at = CASE WHEN kind = 'full' THEN $3::timestamptz ELSE NULL END, last_error = NULL WHERE id = $1 AND status = 'running'").bind(iteration_id).bind(now).bind(next).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn complete_ready_iterations(&self, interval_seconds: u64) -> Result<()> {
        let now = Utc::now();
        let next = now + Duration::seconds(interval_seconds.max(1) as i64);
        sqlx::query("UPDATE wallet_sync_iterations AS iteration SET status = 'completed', completed_at = $1, stats_synced_at = $1, next_run_at = CASE WHEN iteration.kind = 'full' THEN $2::timestamptz ELSE NULL END, last_error = NULL WHERE iteration.status IN ('running', 'failed') AND iteration.processed_count >= iteration.expected_count AND NOT EXISTS (SELECT 1 FROM wallet_sync_state AS state WHERE state.iteration_id = iteration.id AND state.stats_synced_at IS NULL AND state.stats_observed_at IS NOT NULL)").bind(now).bind(next).execute(&self.pool).await?;
        Ok(())
    }
   130|}

```
