# ReadFile  (S4, first seen in request 66, call_id call_e00454ef43b2461fb9e00722652de424, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/store_roster.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nfrom collections.abc import Iterable\nfrom datetime import UTC, datetime\n\nimport asyncpg\n\n\nclass WalletRosterMixin:\n    10|    pool: asyncpg.Pool\n\n    async def sync_roster(\n        self,\n        active_logins: Iterable[str],\n        *,\n        seen_at: datetime | None = None,\n    ) -> None:\n        seen_at = seen_at or datetime.now(UTC)\n        logins = [str(login) for login in active_logins if str(login or \"\")]\n    20|        async with self.pool.acquire() as conn, conn.transaction():\n            if logins:\n                await conn.execute(_UPSERT_ROSTER_SQL, logins, seen_at)\n            await conn.execute(_DEACTIVATE_STALE_ROSTER_SQL, seen_at)\n\n\n_UPSERT_ROSTER_SQL = \"\"\"\n    INSERT INTO wallet_sync_state\n    (login, active, roster_seen_at, next_attempt_at, updated_at)\n    SELECT DISTINCT\n    30|        login,\n        TRUE,\n        $2::timestamptz,\n        $2::timestamptz,\n        $2::timestamptz\n    FROM unnest($1::text[]) AS item(login)\n    ON CONFLICT (login) DO UPDATE SET\n        active = TRUE,\n        roster_seen_at = EXCLUDED.roster_seen_at,\n        updated_at = EXCLUDED.updated_at\n    40|    \"\"\"\n\n_DEACTIVATE_STALE_ROSTER_SQL = \"\"\"\n    UPDATE wallet_sync_state\n    SET active = FALSE,\n        updated_at = $1\n    WHERE roster_seen_at < $1\n    \"\"\"\n", "type": "input_text"}]
```
