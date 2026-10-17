# ReadFile  (S2, first seen in request 24, call_id call_de0259cba7e3427b9722415080171f10, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_stats_sql.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nPENDING_STATS_SQL = \"\"\"\n    SELECT\n        login,\n        wallet_minor,\n        currency_id,\n        iteration_id,\n        stats_bucket_at,\n    10|        stats_observed_at\n    FROM wallet_sync_state\n    WHERE stats_synced_at IS NULL\n      AND stats_observed_at IS NOT NULL\n      AND stats_bucket_at IS NOT NULL\n      AND wallet_minor IS NOT NULL\n      AND currency_id IS NOT NULL\n      AND iteration_id IS NOT NULL\n    ORDER BY iteration_id, login\n    LIMIT $1\n    20|    \"\"\"\n\nMARK_STATS_SYNCED_SQL = \"\"\"\n    UPDATE wallet_sync_state AS state\n    SET stats_synced_at = $3,\n        updated_at = $3\n    FROM unnest($1::text[], $2::bigint[]) AS synced(login, iteration_id)\n    WHERE state.login = synced.login\n      AND state.iteration_id = synced.iteration_id\n      AND state.stats_synced_at IS NULL\n    30|    \"\"\"\n\nCOMPLETE_READY_ITERATIONS_SQL = \"\"\"\n    UPDATE wallet_sync_iterations AS iteration\n    SET status = 'completed',\n        completed_at = $1,\n        stats_synced_at = $1,\n        next_run_at = CASE\n            WHEN iteration.kind = 'full' THEN $2::timestamptz\n            ELSE NULL\n    40|        END,\n        last_error = NULL\n    WHERE iteration.status IN ('running', 'failed')\n      AND iteration.processed_count >= iteration.expected_count\n      AND NOT EXISTS (\n          SELECT 1\n          FROM wallet_sync_state AS state\n          WHERE state.iteration_id = iteration.id\n            AND state.stats_synced_at IS NULL\n            AND state.stats_observed_at IS NOT NULL\n    50|      )\n    \"\"\"\n", "type": "input_text"}]
```
