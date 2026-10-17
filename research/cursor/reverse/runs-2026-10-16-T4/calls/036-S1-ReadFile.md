# ReadFile  (S1, first seen in request 37, call_id call_a01bfb6a3c0c4cc8b5bb0338916393b0, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/postgres/000012_wallet_due_scheduler.sql"}
```

## Output

```
[{"text": "ALTER TABLE wallet_sync_iterations\nADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'full';\n\nALTER TABLE wallet_sync_iterations\nDROP CONSTRAINT IF EXISTS wallet_sync_iterations_kind_check;\n\nALTER TABLE wallet_sync_iterations\nADD CONSTRAINT wallet_sync_iterations_kind_check\nCHECK (kind IN ('full', 'retry'));\n    10|\nCREATE INDEX IF NOT EXISTS wallet_sync_iterations_full_completed_idx\nON wallet_sync_iterations (completed_at DESC, id DESC)\nWHERE status = 'completed'\n  AND kind = 'full';\n\nCREATE INDEX IF NOT EXISTS wallet_sync_state_due_retry_idx\nON wallet_sync_state (next_attempt_at, login)\nWHERE active = TRUE\n  AND last_error IS NOT NULL;\n    20|", "type": "input_text"}]
```
