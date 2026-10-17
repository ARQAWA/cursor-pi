# ReadFile  (S1, first seen in request 16, call_id call_065dd0c0b7ea464791a8a81cf6c961b2, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nUPDATE_FAILURE_STATE_SQL = \"\"\"\n    UPDATE wallet_sync_state\n    SET next_attempt_at = $2,\n        retry_count = retry_count + 1,\n        last_error = $3,\n        updated_at = $4\n    WHERE login = $1\n    10|    RETURNING retry_count\n    \"\"\"\n\nINCREMENT_FAILURE_SQL = \"\"\"\n    UPDATE wallet_sync_iterations\n    SET processed_count = processed_count + 1,\n        failed_count = failed_count + 1,\n        last_error = COALESCE(last_error, $2)\n    WHERE id = $1\n    \"\"\"\n    20|", "type": "input_text"}]
```
