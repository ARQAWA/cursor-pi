# ReadFile  (S2, first seen in request 45, call_id call_6920e3c34cb9482493b148cecc77d009, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_roster.py"}
```

## Output

```
from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

import asyncpg


class WalletRosterMixin:
    10|    pool: asyncpg.Pool

    async def sync_roster(
        self,
        active_logins: Iterable[str],
        *,
        seen_at: datetime | None = None,
    ) -> None:
        seen_at = seen_at or datetime.now(UTC)
        logins = [str(login) for login in active_logins if str(login or "")]
    20|        async with self.pool.acquire() as conn, conn.transaction():
            if logins:
                await conn.execute(_UPSERT_ROSTER_SQL, logins, seen_at)
            await conn.execute(_DEACTIVATE_STALE_ROSTER_SQL, seen_at)


_UPSERT_ROSTER_SQL = """
    INSERT INTO wallet_sync_state
    (login, active, roster_seen_at, next_attempt_at, updated_at)
    SELECT DISTINCT
    30|        login,
        TRUE,
        $2::timestamptz,
        $2::timestamptz,
        $2::timestamptz
    FROM unnest($1::text[]) AS item(login)
    ON CONFLICT (login) DO UPDATE SET
        active = TRUE,
        roster_seen_at = EXCLUDED.roster_seen_at,
        updated_at = EXCLUDED.updated_at
    40|    """

_DEACTIVATE_STALE_ROSTER_SQL = """
    UPDATE wallet_sync_state
    SET active = FALSE,
        updated_at = $1
    WHERE roster_seen_at < $1
    """

```
