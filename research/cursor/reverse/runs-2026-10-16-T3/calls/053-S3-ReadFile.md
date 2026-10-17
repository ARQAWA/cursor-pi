# ReadFile  (S3, first seen in request 59, call_id call_c9cc054905bc4f5e81542df042fd3195, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_stats_sql.py"}
```

## Output

```
from __future__ import annotations

PENDING_STATS_SQL = """
    SELECT
        login,
        wallet_minor,
        currency_id,
        iteration_id,
        stats_bucket_at,
    10|        stats_observed_at
    FROM wallet_sync_state
    WHERE stats_synced_at IS NULL
      AND stats_observed_at IS NOT NULL
      AND stats_bucket_at IS NOT NULL
      AND wallet_minor IS NOT NULL
      AND currency_id IS NOT NULL
      AND iteration_id IS NOT NULL
    ORDER BY iteration_id, login
    LIMIT $1
    20|    """

MARK_STATS_SYNCED_SQL = """
    UPDATE wallet_sync_state AS state
    SET stats_synced_at = $3,
        updated_at = $3
    FROM unnest($1::text[], $2::bigint[]) AS synced(login, iteration_id)
    WHERE state.login = synced.login
      AND state.iteration_id = synced.iteration_id
      AND state.stats_synced_at IS NULL
    30|    """

COMPLETE_READY_ITERATIONS_SQL = """
    UPDATE wallet_sync_iterations AS iteration
    SET status = 'completed',
        completed_at = $1,
        stats_synced_at = $1,
        next_run_at = CASE
            WHEN iteration.kind = 'full' THEN $2::timestamptz
            ELSE NULL
    40|        END,
        last_error = NULL
    WHERE iteration.status IN ('running', 'failed')
      AND iteration.processed_count >= iteration.expected_count
      AND NOT EXISTS (
          SELECT 1
          FROM wallet_sync_state AS state
          WHERE state.iteration_id = iteration.id
            AND state.stats_synced_at IS NULL
            AND state.stats_observed_at IS NOT NULL
    50|      )
    """

```
