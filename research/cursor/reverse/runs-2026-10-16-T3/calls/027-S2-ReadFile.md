# ReadFile  (S2, first seen in request 31, call_id call_55079baecfff4ff98482d7d138d64a1e, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py"}
```

## Output

```
from __future__ import annotations

UPDATE_FAILURE_STATE_SQL = """
    UPDATE wallet_sync_state
    SET next_attempt_at = $2,
        retry_count = retry_count + 1,
        last_error = $3,
        updated_at = $4
    WHERE login = $1
    10|    RETURNING retry_count
    """

INCREMENT_FAILURE_SQL = """
    UPDATE wallet_sync_iterations
    SET processed_count = processed_count + 1,
        failed_count = failed_count + 1,
        last_error = COALESCE(last_error, $2)
    WHERE id = $1
    """
    20|
```
