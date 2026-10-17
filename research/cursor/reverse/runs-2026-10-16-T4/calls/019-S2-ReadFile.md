# ReadFile  (S2, first seen in request 19, call_id call_c2105b1129114fdc8990ecbe775082ec, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/scheduler.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nimport asyncio\nfrom datetime import UTC, datetime\nfrom typing import Any, cast\n\nfrom superbot_ng.repositories.postgres.wallet.store_iterations import (\n    WalletIterationKind,\n)\n    10|from superbot_ng.workers.wallet.iteration import run_wallet_iteration_once\n\nWALLET_RETRY_BATCH_SIZE = 1000\n\n\nasync def next_wallet_wake_at(store: Any) -> datetime | None:\n    full_at = cast(datetime | None, await store.latest_next_run_at())\n    if full_at is None:\n        return None\n    retry_at = cast(datetime | None, await store.earliest_retry_at())\n    20|    if retry_at is None:\n        return full_at\n    return min(full_at, retry_at)\n\n\nasync def run_due_wallet_iteration(\n    runner: Any,\n    stop_event: asyncio.Event,\n    *,\n    active_login_loader: Any,\n    30|    now: datetime | None = None,\n) -> bool:\n    started_at = now or datetime.now(UTC)\n    work = await _load_due_work(runner, active_login_loader, started_at)\n    if work is None:\n        return False\n    kind, active_logins = work\n    if kind == \"full\":\n        runner.cookie_jars.retain(active_logins)\n    await run_wallet_iteration_once(\n    40|        runner,\n        stop_event,\n        active_logins=active_logins,\n        kind=kind,\n        started_at=started_at,\n    )\n    return True\n\n\nasync def _load_due_work(\n    50|    runner: Any,\n    active_login_loader: Any,\n    now: datetime,\n) -> tuple[WalletIterationKind, list[str]] | None:\n    full_at = await runner.store.latest_next_run_at()\n    if full_at is None or full_at <= now:\n        active_logins = await active_login_loader(runner.active_login_reader)\n        return \"full\", active_logins\n    retry_logins = await runner.store.due_retry_logins(\n        now=now,\n    60|        limit=WALLET_RETRY_BATCH_SIZE,\n    )\n    if not retry_logins:\n        return None\n    return \"retry\", retry_logins\n", "type": "input_text"}]
```
