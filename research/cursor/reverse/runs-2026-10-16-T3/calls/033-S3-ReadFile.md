# ReadFile  (S3, first seen in request 37, call_id call_d7d8d8153e6e488abc09692bb13a72f9, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_iterations.py"}
```

## Output

```
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

import asyncpg

WalletIterationKind = Literal["full", "retry"]

    10|
class WalletIterationMixin:
    pool: asyncpg.Pool

    async def begin_iteration(
        self,
        *,
        expected_count: int,
        kind: WalletIterationKind,
        started_at: datetime | None = None,
    20|    ) -> int:
        started_at = started_at or datetime.now(UTC)
        value = await self.pool.fetchval(
            _BEGIN_ITERATION_SQL,
            started_at,
            int(expected_count),
            str(kind),
        )
        return int(value)

    30|    async def latest_next_run_at(self) -> datetime | None:
        value = await self.pool.fetchval(_LATEST_NEXT_RUN_SQL)
        return value if isinstance(value, datetime) else None

    async def mark_unfinished_iterations_failed(self, *, message: str) -> None:
        await self.pool.execute(_MARK_UNFINISHED_FAILED_SQL, str(message))

    async def complete_iteration(
        self,
        iteration_id: int,
    40|        *,
        completed_at: datetime | None = None,
        interval_seconds: int,
    ) -> None:
        completed_at = completed_at or datetime.now(UTC)
        next_run_at = completed_at + timedelta(seconds=max(1, int(interval_seconds)))
        await self.pool.execute(
            _COMPLETE_ITERATION_SQL,
            int(iteration_id),
            completed_at,
    50|            next_run_at,
        )


_BEGIN_ITERATION_SQL = """
    INSERT INTO wallet_sync_iterations
    (started_at, status, expected_count, processed_count, success_count, failed_count, kind)
    VALUES ($1, 'running', $2, 0, 0, 0, $3)
    RETURNING id
    """
    60|
_LATEST_NEXT_RUN_SQL = """
    SELECT next_run_at
    FROM wallet_sync_iterations
    WHERE status = 'completed'
      AND kind = 'full'
    ORDER BY completed_at DESC NULLS LAST, id DESC
    LIMIT 1
    """

    70|_MARK_UNFINISHED_FAILED_SQL = """
    UPDATE wallet_sync_iterations
    SET status = 'failed',
        completed_at = COALESCE(completed_at, now()),
        last_error = $1
    WHERE status = 'running'
    """

_COMPLETE_ITERATION_SQL = """
    UPDATE wallet_sync_iterations
    80|    SET status = 'completed',
        completed_at = $2,
        stats_synced_at = $2,
        next_run_at = CASE
            WHEN kind = 'full' THEN $3::timestamptz
            ELSE NULL
        END,
        last_error = NULL
    WHERE id = $1
      AND status = 'running'
    90|    """

```
