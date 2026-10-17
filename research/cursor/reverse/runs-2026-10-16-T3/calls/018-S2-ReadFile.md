# ReadFile  (S2, first seen in request 22, call_id call_781dc143af2b4a66a978f662eacf8dc5, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/scheduler.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, cast

from superbot_ng.repositories.postgres.wallet.store_iterations import (
    WalletIterationKind,
)
    10|from superbot_ng.workers.wallet.iteration import run_wallet_iteration_once

WALLET_RETRY_BATCH_SIZE = 1000


async def next_wallet_wake_at(store: Any) -> datetime | None:
    full_at = cast(datetime | None, await store.latest_next_run_at())
    if full_at is None:
        return None
    retry_at = cast(datetime | None, await store.earliest_retry_at())
    20|    if retry_at is None:
        return full_at
    return min(full_at, retry_at)


async def run_due_wallet_iteration(
    runner: Any,
    stop_event: asyncio.Event,
    *,
    active_login_loader: Any,
    30|    now: datetime | None = None,
) -> bool:
    started_at = now or datetime.now(UTC)
    work = await _load_due_work(runner, active_login_loader, started_at)
    if work is None:
        return False
    kind, active_logins = work
    if kind == "full":
        runner.cookie_jars.retain(active_logins)
    await run_wallet_iteration_once(
    40|        runner,
        stop_event,
        active_logins=active_logins,
        kind=kind,
        started_at=started_at,
    )
    return True


async def _load_due_work(
    50|    runner: Any,
    active_login_loader: Any,
    now: datetime,
) -> tuple[WalletIterationKind, list[str]] | None:
    full_at = await runner.store.latest_next_run_at()
    if full_at is None or full_at <= now:
        active_logins = await active_login_loader(runner.active_login_reader)
        return "full", active_logins
    retry_logins = await runner.store.due_retry_logins(
        now=now,
    60|        limit=WALLET_RETRY_BATCH_SIZE,
    )
    if not retry_logins:
        return None
    return "retry", retry_logins

```
