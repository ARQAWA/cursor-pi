# ReadFile  (S4, first seen in request 71, call_id call_a05258b62d1440fb9ade8a4d109c52aa, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/postgres/000007_wallet_sync.sql"}
```

## Output

```
[{"text": "CREATE TABLE IF NOT EXISTS wallet_sync_iterations\n(\n    id BIGSERIAL PRIMARY KEY,\n    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    completed_at TIMESTAMPTZ,\n    status TEXT NOT NULL,\n    expected_count INTEGER NOT NULL DEFAULT 0,\n    processed_count INTEGER NOT NULL DEFAULT 0,\n    success_count INTEGER NOT NULL DEFAULT 0,\n    10|    failed_count INTEGER NOT NULL DEFAULT 0,\n    stats_synced_at TIMESTAMPTZ,\n    next_run_at TIMESTAMPTZ,\n    last_error TEXT,\n    CONSTRAINT wallet_sync_iterations_status_check\n        CHECK (status IN ('running', 'completed', 'failed')),\n    CONSTRAINT wallet_sync_iterations_counts_nonnegative\n        CHECK (\n            expected_count >= 0\n            AND processed_count >= 0\n    20|            AND success_count >= 0\n            AND failed_count >= 0\n        )\n);\n\nCREATE INDEX IF NOT EXISTS wallet_sync_iterations_completed_idx\nON wallet_sync_iterations (completed_at DESC, id DESC)\nWHERE status = 'completed';\n\nCREATE TABLE IF NOT EXISTS wallet_sync_state\n    30|(\n    login TEXT PRIMARY KEY,\n    active BOOLEAN NOT NULL DEFAULT TRUE,\n    roster_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    wallet_minor BIGINT,\n    currency_id INTEGER,\n    last_success_at TIMESTAMPTZ,\n    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    retry_count INTEGER NOT NULL DEFAULT 0,\n    last_error TEXT,\n    40|    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    iteration_id BIGINT REFERENCES wallet_sync_iterations(id),\n    stats_bucket_at TIMESTAMPTZ,\n    stats_observed_at TIMESTAMPTZ,\n    stats_synced_at TIMESTAMPTZ,\n    CONSTRAINT wallet_sync_state_retry_count_nonnegative\n        CHECK (retry_count >= 0),\n    CONSTRAINT wallet_sync_state_wallet_minor_nonnegative\n        CHECK (wallet_minor IS NULL OR wallet_minor >= 0)\n);\n    50|\nCREATE INDEX IF NOT EXISTS wallet_sync_state_active_idx\nON wallet_sync_state (active, login)\nWHERE active = TRUE;\n\nCREATE INDEX IF NOT EXISTS wallet_sync_state_pending_stats_idx\nON wallet_sync_state (iteration_id, login)\nWHERE stats_synced_at IS NULL\n  AND stats_observed_at IS NOT NULL;\n\n    60|CREATE INDEX IF NOT EXISTS wallet_sync_state_roster_seen_idx\nON wallet_sync_state (roster_seen_at);\n", "type": "input_text"}]
```
