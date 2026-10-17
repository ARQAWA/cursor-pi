# ReadFile  (S3, first seen in request 34, call_id call_8a9f2546892949e89c7cd19c48453447, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/iteration.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, cast

from superbot_ng.domain.wallet import WalletStatsEvent
from superbot_ng.platform.logging import log_cyan
from superbot_ng.platform.runtime import ExpectedShutdown, run_bounded_workers
    10|from superbot_ng.repositories.postgres.wallet.store_iterations import (
    WalletIterationKind,
)


async def run_wallet_iteration_once(
    runner: Any,
    stop_event: asyncio.Event,
    *,
    active_logins: list[str],
    20|    kind: WalletIterationKind,
    started_at: datetime,
) -> None:
    iteration_id = await _begin_iteration(runner, active_logins, started_at, kind)
    stats_events = await _collect_stats_events(
        runner,
        active_logins,
        iteration_id=iteration_id,
        started_at=started_at,
        stop_event=stop_event,
    30|    )
    await _commit_iteration(
        runner,
        iteration_id,
        active_logins,
        stats_events,
        stop_event,
        kind,
    )

    40|
async def _begin_iteration(
    runner: Any,
    active_logins: list[str],
    started_at: datetime,
    kind: WalletIterationKind,
) -> int:
    if kind == "full":
        await runner.store.sync_roster(active_logins, seen_at=started_at)
    iteration_id = await runner.store.begin_iteration(
    50|        expected_count=len(active_logins),
        kind=kind,
        started_at=started_at,
    )
    await log_cyan(
        f"WalletSync|iteration_start|id={iteration_id}|kind={kind}|users={len(active_logins)}"
    )
    return cast(int, iteration_id)


    60|async def _collect_stats_events(
    runner: Any,
    active_logins: list[str],
    *,
    iteration_id: int,
    started_at: datetime,
    stop_event: asyncio.Event,
) -> list[WalletStatsEvent]:
    stats_events: list[WalletStatsEvent | None] = [None] * len(active_logins)

    70|    async def _worker(item: tuple[int, str]) -> None:
        index, login = item
        event = await runner._sync_one(
            login,
            iteration_id=iteration_id,
            bucket_at=started_at,
            stop_event=stop_event,
        )
        if event is not None:
            stats_events[index] = event
    80|
    await run_bounded_workers(
        list(enumerate(active_logins)),
        _worker,
        max_workers=runner.concurrency,
        stop_event=stop_event,
    )
    if stop_event.is_set():
        raise ExpectedShutdown()
    return [event for event in stats_events if event is not None]
    90|

async def _commit_iteration(
    runner: Any,
    iteration_id: int,
    active_logins: list[str],
    stats_events: list[WalletStatsEvent],
    stop_event: asyncio.Event,
    kind: WalletIterationKind,
) -> None:
   100|    await runner.writer.send_stats_and_wait(
        stats_events,
        batch_id=f"wallet-{iteration_id}",
        stop_event=stop_event,
    )
    await runner.store.mark_stats_synced(stats_events)
    await runner.store.complete_iteration(
        iteration_id,
        interval_seconds=runner.interval_seconds,
    )
   110|    await log_cyan(
        f"WalletSync|iteration_done|id={iteration_id}|kind={kind}|"
        f"users={len(active_logins)}|stats={len(stats_events)}"
    )

```
