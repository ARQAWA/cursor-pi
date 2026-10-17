# ReadFile  (S3, first seen in request 52, call_id call_3c79863ca3654fe7a3a3860dea7ea1b4, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_scheduler_contracts.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path


def test_wallet_due_scheduler_migration_keeps_full_and_retry_contract() -> None:
    migration = Path("migrations/postgres/000012_wallet_due_scheduler.sql").read_text(
    10|        encoding="utf-8"
    )

    assert "kind TEXT NOT NULL DEFAULT 'full'" in migration
    assert "CHECK (kind IN ('full', 'retry'))" in migration
    assert "kind = 'full'" in migration
    assert "wallet_sync_state (next_attempt_at, login)" in migration
    assert "active = TRUE" in migration
    assert "last_error IS NOT NULL" in migration

    20|
def test_wallet_retry_repository_uses_due_index_shape_and_limit() -> None:
    from superbot_ng.repositories.postgres.wallet.store_retry_schedule import (
        _DUE_RETRY_LOGINS_SQL,
        _EARLIEST_RETRY_AT_SQL,
        WalletRetryScheduleMixin,
    )

    now = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)
    earliest = now + timedelta(seconds=30)
    30|    calls: list[tuple[object, ...]] = []

    class _Pool:
        async def fetchval(self, *args):
            calls.append(("fetchval", *args))
            return earliest

        async def fetch(self, *args):
            calls.append(("fetch", *args))
            return [{"login": "u1"}, {"login": "u2"}]
    40|
    class _Store(WalletRetryScheduleMixin):
        pass

    async def _run():
        store = _Store()
        store.pool = _Pool()
        return await store.earliest_retry_at(), await store.due_retry_logins(
            now=now,
            limit=1000,
    50|        )

    retry_at, logins = asyncio.run(_run())

    assert retry_at == earliest
    assert logins == ["u1", "u2"]
    assert calls == [
        ("fetchval", _EARLIEST_RETRY_AT_SQL),
        ("fetch", _DUE_RETRY_LOGINS_SQL, now, 1000),
    ]
    60|    assert "active = TRUE" in _DUE_RETRY_LOGINS_SQL
    assert "last_error IS NOT NULL" in _DUE_RETRY_LOGINS_SQL
    assert "next_attempt_at <= $1" in _DUE_RETRY_LOGINS_SQL
    assert "ORDER BY next_attempt_at, login" in _DUE_RETRY_LOGINS_SQL
    assert "LIMIT $2" in _DUE_RETRY_LOGINS_SQL


def test_wallet_scheduler_gives_due_full_iteration_priority(monkeypatch) -> None:
    from superbot_ng.workers.wallet import scheduler

    70|    now = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)
    calls: list[tuple[object, ...]] = []

    class _Store:
        async def latest_next_run_at(self):
            return now

        async def due_retry_logins(self, **_kwargs):
            raise AssertionError("retry query must not run while full is due")

    80|    class _Runner:
        store = _Store()
        active_login_reader = object()
        cookie_jars = type(
            "_CookieJars",
            (),
            {"retain": lambda _self, logins: calls.append(("retain", tuple(logins)))},
        )()

    async def _active(_reader):
    90|        calls.append(("active",))
        return ["u1", "u2"]

    async def _iteration(_runner, _stop_event, **kwargs):
        calls.append(("iteration", kwargs["kind"], tuple(kwargs["active_logins"])))

    monkeypatch.setattr(scheduler, "run_wallet_iteration_once", _iteration)
    result = asyncio.run(
        scheduler.run_due_wallet_iteration(
            _Runner(),
   100|            asyncio.Event(),
            active_login_loader=_active,
            now=now,
        )
    )

    assert result is True
    assert calls == [
        ("active",),
        ("retain", ("u1", "u2")),
   110|        ("iteration", "full", ("u1", "u2")),
    ]


def test_wallet_scheduler_runs_only_due_failed_users(monkeypatch) -> None:
    from superbot_ng.workers.wallet import scheduler

    now = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)
    calls: list[tuple[object, ...]] = []

   120|    class _Store:
        async def latest_next_run_at(self):
            return now + timedelta(minutes=10)

        async def due_retry_logins(self, *, now, limit):
            calls.append(("due", now, limit))
            return ["u2", "u4"]

    class _Runner:
        store = _Store()
   130|        active_login_reader = object()
        cookie_jars = type(
            "_CookieJars",
            (),
            {
                "retain": lambda _self, _logins: (_ for _ in ()).throw(
                    AssertionError("retry must not prune cookie jars")
                )
            },
        )()
   140|
    async def _active(_reader):
        raise AssertionError("full roster must not load for retry")

    async def _iteration(_runner, _stop_event, **kwargs):
        calls.append(("iteration", kwargs["kind"], tuple(kwargs["active_logins"])))

    monkeypatch.setattr(scheduler, "run_wallet_iteration_once", _iteration)
    result = asyncio.run(
        scheduler.run_due_wallet_iteration(
   150|            _Runner(),
            asyncio.Event(),
            active_login_loader=_active,
            now=now,
        )
    )

    assert result is True
    assert calls == [
        ("due", now, 1000),
   160|        ("iteration", "retry", ("u2", "u4")),
    ]


def test_wallet_scheduler_skips_empty_retry_without_iteration(monkeypatch) -> None:
    from superbot_ng.workers.wallet import scheduler

    now = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)

    class _Store:
   170|        async def latest_next_run_at(self):
            return now + timedelta(minutes=10)

        async def due_retry_logins(self, *, now, limit):
            assert limit == 1000
            return []

    class _Runner:
        store = _Store()
        active_login_reader = object()
   180|
    async def _active(_reader):
        raise AssertionError("unexpected full roster load")

    async def _iteration(*_args, **_kwargs):
        raise AssertionError("empty retry must not create iteration")

    monkeypatch.setattr(scheduler, "run_wallet_iteration_once", _iteration)
    result = asyncio.run(
        scheduler.run_due_wallet_iteration(
   190|            _Runner(),
            asyncio.Event(),
            active_login_loader=_active,
            now=now,
        )
    )

    assert result is False


   200|def test_wallet_wake_uses_earliest_schedule_but_missing_full_runs_now() -> None:
    from superbot_ng.workers.wallet.scheduler import next_wallet_wake_at

    now = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)

    class _Store:
        def __init__(self, full_at, retry_at):
            self.full_at = full_at
            self.retry_at = retry_at
            self.retry_reads = 0
   210|
        async def latest_next_run_at(self):
            return self.full_at

        async def earliest_retry_at(self):
            self.retry_reads += 1
            return self.retry_at

    retry_first = _Store(now + timedelta(minutes=10), now + timedelta(seconds=30))
    full_first = _Store(now + timedelta(seconds=20), now + timedelta(seconds=30))
   220|    missing_full = _Store(None, now + timedelta(seconds=30))

    assert asyncio.run(next_wallet_wake_at(retry_first)) == now + timedelta(seconds=30)
    assert asyncio.run(next_wallet_wake_at(full_first)) == now + timedelta(seconds=20)
    assert asyncio.run(next_wallet_wake_at(missing_full)) is None
    assert missing_full.retry_reads == 0


def test_wallet_retry_iteration_does_not_sync_full_roster() -> None:
    from superbot_ng.domain.wallet import WalletStatsEvent
   230|    from superbot_ng.workers.wallet.iteration import run_wallet_iteration_once

    now = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)
    trace: list[tuple[object, ...]] = []

    class _Store:
        async def sync_roster(self, *_args, **_kwargs):
            raise AssertionError("retry must not sync full roster")

        async def begin_iteration(self, *, expected_count, kind, started_at):
   240|            trace.append(("begin", expected_count, kind, started_at))
            return 44

        async def mark_stats_synced(self, events):
            trace.append(("synced", tuple(event.login for event in events)))

        async def complete_iteration(self, iteration_id, *, interval_seconds):
            trace.append(("complete", iteration_id, interval_seconds))

    class _Writer:
   250|        async def send_stats_and_wait(self, events, *, batch_id, stop_event):
            trace.append(("kafka", batch_id, tuple(event.login for event in events)))

    class _Runner:
        store = _Store()
        writer = _Writer()
        concurrency = 2
        interval_seconds = 900

        async def _sync_one(self, login, **_kwargs):
   260|            return WalletStatsEvent(
                bucket_at=now,
                observed_at=now,
                login=login,
                wallet_minor=100,
                currency_id=8,
                iteration_id=44,
            )

    asyncio.run(
   270|        run_wallet_iteration_once(
            _Runner(),
            asyncio.Event(),
            active_logins=["u2", "u4"],
            kind="retry",
            started_at=now,
        )
    )

    assert trace[0] == ("begin", 2, "retry", now)
   280|    assert trace[-1] == ("complete", 44, 900)
    assert ("kafka", "wallet-44", ("u2", "u4")) in trace


def test_wallet_iteration_sql_keeps_retry_from_moving_full_schedule() -> None:
    from superbot_ng.repositories.postgres.wallet.store_iterations import (
        _BEGIN_ITERATION_SQL,
        _COMPLETE_ITERATION_SQL,
        _LATEST_NEXT_RUN_SQL,
    )
   290|    from superbot_ng.repositories.postgres.wallet.store_stats_sql import (
        COMPLETE_READY_ITERATIONS_SQL,
    )

    assert "kind" in _BEGIN_ITERATION_SQL
    assert "kind = 'full'" in _LATEST_NEXT_RUN_SQL
    assert "WHEN kind = 'full' THEN $3::timestamptz" in _COMPLETE_ITERATION_SQL
    assert (
        "WHEN iteration.kind = 'full' THEN $2::timestamptz"
        in COMPLETE_READY_ITERATIONS_SQL
   300|    )

```
