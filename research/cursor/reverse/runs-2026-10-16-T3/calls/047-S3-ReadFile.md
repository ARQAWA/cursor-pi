# ReadFile  (S3, first seen in request 53, call_id call_31bd46bd7ca54380a0c8ca06acb2b6af, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/postgres/000007_wallet_sync.sql"}
```

## Output

```
CREATE TABLE IF NOT EXISTS wallet_sync_iterations
(
    id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    expected_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    10|    failed_count INTEGER NOT NULL DEFAULT 0,
    stats_synced_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    last_error TEXT,
    CONSTRAINT wallet_sync_iterations_status_check
        CHECK (status IN ('running', 'completed', 'failed')),
    CONSTRAINT wallet_sync_iterations_counts_nonnegative
        CHECK (
            expected_count >= 0
            AND processed_count >= 0
    20|            AND success_count >= 0
            AND failed_count >= 0
        )
);

CREATE INDEX IF NOT EXISTS wallet_sync_iterations_completed_idx
ON wallet_sync_iterations (completed_at DESC, id DESC)
WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS wallet_sync_state
    30|(
    login TEXT PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    roster_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    wallet_minor BIGINT,
    currency_id INTEGER,
    last_success_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    40|    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    iteration_id BIGINT REFERENCES wallet_sync_iterations(id),
    stats_bucket_at TIMESTAMPTZ,
    stats_observed_at TIMESTAMPTZ,
    stats_synced_at TIMESTAMPTZ,
    CONSTRAINT wallet_sync_state_retry_count_nonnegative
        CHECK (retry_count >= 0),
    CONSTRAINT wallet_sync_state_wallet_minor_nonnegative
        CHECK (wallet_minor IS NULL OR wallet_minor >= 0)
);
    50|
CREATE INDEX IF NOT EXISTS wallet_sync_state_active_idx
ON wallet_sync_state (active, login)
WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS wallet_sync_state_pending_stats_idx
ON wallet_sync_state (iteration_id, login)
WHERE stats_synced_at IS NULL
  AND stats_observed_at IS NOT NULL;

    60|CREATE INDEX IF NOT EXISTS wallet_sync_state_roster_seen_idx
ON wallet_sync_state (roster_seen_at);

```
