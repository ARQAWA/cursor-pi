# ReadFile  (S2, first seen in request 35, call_id call_e0ff9544ad6d432baa2eb41314bbcd14, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_sync_results.py"}
```

## Output

```
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import asyncpg

from superbot_ng.domain.wallet import WalletStatsEvent
from superbot_ng.repositories.postgres.wallet.store_sync_failure_sql import (
    INCREMENT_FAILURE_SQL,
    10|    UPDATE_FAILURE_STATE_SQL,
)


class WalletSyncResultMixin:
    pool: asyncpg.Pool

    async def record_success(
        self,
        event: WalletStatsEvent,
    20|        *,
        next_attempt_at: datetime,
    ) -> None:
        async with self.pool.acquire() as conn, conn.transaction():
            await conn.execute(
                _UPDATE_SUCCESS_STATE_SQL,
                *_success_state_args(event, next_attempt_at),
            )
            await conn.execute(_INCREMENT_SUCCESS_SQL, int(event.iteration_id))

    30|    async def record_failure(
        self,
        *,
        login: str,
        iteration_id: int,
        message: str,
        retry_after_seconds: int,
        now: datetime | None = None,
    ) -> int:
        now = now or datetime.now(UTC)
    40|        next_attempt_at = now + timedelta(seconds=max(1, int(retry_after_seconds)))
        async with self.pool.acquire() as conn, conn.transaction():
            retry_count = await conn.fetchval(
                UPDATE_FAILURE_STATE_SQL,
                str(login),
                next_attempt_at,
                str(message),
                now,
            )
            if retry_count is None:
    50|                raise RuntimeError(f"wallet sync state missing for login={login}")
            await conn.execute(INCREMENT_FAILURE_SQL, int(iteration_id), str(message))
        return int(retry_count)


def _success_state_args(
    event: WalletStatsEvent,
    next_attempt_at: datetime,
) -> tuple[object, ...]:
    return (
    60|        event.login,
        int(event.wallet_minor),
        int(event.currency_id),
        event.observed_at,
        next_attempt_at,
        int(event.iteration_id),
        event.bucket_at,
    )


    70|_UPDATE_SUCCESS_STATE_SQL = """
    UPDATE wallet_sync_state
    SET wallet_minor = $2,
        currency_id = $3,
        last_success_at = $4,
        next_attempt_at = $5,
        retry_count = 0,
        last_error = NULL,
        updated_at = $4,
        iteration_id = $6,
    80|        stats_bucket_at = $7,
        stats_observed_at = $4,
        stats_synced_at = NULL
    WHERE login = $1
    """

_INCREMENT_SUCCESS_SQL = """
    UPDATE wallet_sync_iterations
    SET processed_count = processed_count + 1,
        success_count = success_count + 1
    90|    WHERE id = $1
    """

```
