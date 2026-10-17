# ReadFile  (S2, first seen in request 33, call_id call_59fcb8f014df406892d26ae0b1df9915, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py"}
```

## Output

```
from __future__ import annotations

from datetime import UTC, datetime

import asyncpg


class WalletRetryScheduleMixin:
    pool: asyncpg.Pool
    10|
    async def earliest_retry_at(self) -> datetime | None:
        value = await self.pool.fetchval(_EARLIEST_RETRY_AT_SQL)
        return value if isinstance(value, datetime) else None

    async def due_retry_logins(
        self,
        *,
        now: datetime | None = None,
        limit: int = 1000,
    20|    ) -> list[str]:
        now = now or datetime.now(UTC)
        rows = await self.pool.fetch(
            _DUE_RETRY_LOGINS_SQL,
            now,
            max(1, int(limit)),
        )
        return [str(row["login"]) for row in rows]


    30|_EARLIEST_RETRY_AT_SQL = """
    SELECT min(next_attempt_at)
    FROM wallet_sync_state
    WHERE active = TRUE
      AND last_error IS NOT NULL
    """

_DUE_RETRY_LOGINS_SQL = """
    SELECT login
    FROM wallet_sync_state
    40|    WHERE active = TRUE
      AND last_error IS NOT NULL
      AND next_attempt_at <= $1
    ORDER BY next_attempt_at, login
    LIMIT $2
    """

```
