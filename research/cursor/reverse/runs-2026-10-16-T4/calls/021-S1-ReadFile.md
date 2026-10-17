# ReadFile  (S1, first seen in request 22, call_id call_096d09de719248ac9a6ff7debb822613, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nfrom datetime import UTC, datetime\n\nimport asyncpg\n\n\nclass WalletRetryScheduleMixin:\n    pool: asyncpg.Pool\n    10|\n    async def earliest_retry_at(self) -> datetime | None:\n        value = await self.pool.fetchval(_EARLIEST_RETRY_AT_SQL)\n        return value if isinstance(value, datetime) else None\n\n    async def due_retry_logins(\n        self,\n        *,\n        now: datetime | None = None,\n        limit: int = 1000,\n    20|    ) -> list[str]:\n        now = now or datetime.now(UTC)\n        rows = await self.pool.fetch(\n            _DUE_RETRY_LOGINS_SQL,\n            now,\n            max(1, int(limit)),\n        )\n        return [str(row[\"login\"]) for row in rows]\n\n\n    30|_EARLIEST_RETRY_AT_SQL = \"\"\"\n    SELECT min(next_attempt_at)\n    FROM wallet_sync_state\n    WHERE active = TRUE\n      AND last_error IS NOT NULL\n    \"\"\"\n\n_DUE_RETRY_LOGINS_SQL = \"\"\"\n    SELECT login\n    FROM wallet_sync_state\n    40|    WHERE active = TRUE\n      AND last_error IS NOT NULL\n      AND next_attempt_at <= $1\n    ORDER BY next_attempt_at, login\n    LIMIT $2\n    \"\"\"\n", "type": "input_text"}]
```
