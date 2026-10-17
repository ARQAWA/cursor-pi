# ReadFile  (S2, first seen in request 38, call_id call_3c09a97b509f448081d3179e9478cfbb, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_failure_contracts.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest


    10|def test_wallet_failure_store_returns_consecutive_retry_count() -> None:
    from superbot_ng.repositories.postgres.wallet.store_sync_failure_sql import (
        INCREMENT_FAILURE_SQL,
        UPDATE_FAILURE_STATE_SQL,
    )
    from superbot_ng.repositories.postgres.wallet.store_sync_results import (
        WalletSyncResultMixin,
    )

    calls: list[tuple[object, ...]] = []
    20|
    class _Context:
        async def __aenter__(self):
            return connection

        async def __aexit__(self, *_args):
            return None

    class _Connection:
        def transaction(self):
    30|            return _Context()

        async def fetchval(self, *args):
            calls.append(("fetchval", *args))
            return 5

        async def execute(self, *args):
            calls.append(("execute", *args))

    class _Pool:
    40|        def acquire(self):
            return _Context()

    class _Store(WalletSyncResultMixin):
        pass

    connection = _Connection()
    store = _Store()
    store.pool = _Pool()
    retry_count = asyncio.run(
    50|        store.record_failure(
            login="u1",
            iteration_id=7,
            message="Http error 500",
            retry_after_seconds=30,
            now=datetime(2026, 5, 11, 10, 0, tzinfo=UTC),
        )
    )

    assert retry_count == 5
    60|    assert calls[0][0:2] == ("fetchval", UPDATE_FAILURE_STATE_SQL)
    assert calls[1] == ("execute", INCREMENT_FAILURE_SQL, 7, "Http error 500")
    assert "RETURNING retry_count" in UPDATE_FAILURE_STATE_SQL


def test_wallet_unexpected_user_error_does_not_cancel_other_users(monkeypatch) -> None:
    from superbot_ng.domain.users import NgSteamCookie, NgSteamUser
    from superbot_ng.domain.wallet import WalletStatsEvent
    from superbot_ng.use_cases.users import RuntimeUserSnapshot
    from superbot_ng.workers.wallet import daemon as module
    70|    from superbot_ng.workers.wallet.observer import WalletAnomalyObserver

    events: list[tuple[object, ...]] = []
    captures: list[tuple[object, ...]] = []

    class _Store:
        async def latest_next_run_at(self):
            return None

        async def sync_roster(self, _logins, *, seen_at):
    80|            return None

        async def begin_iteration(self, *, expected_count, kind, started_at):
            assert kind == "full"
            return 42

        async def record_failure(self, **kwargs):
            events.append(("failed", kwargs["login"], kwargs["message"]))
            return 1

    90|        async def record_success(self, event, *, next_attempt_at):
            events.append(("success", event.login))

        async def mark_stats_synced(self, stats_events):
            events.append(("synced", tuple(event.login for event in stats_events)))

        async def complete_iteration(self, iteration_id, *, interval_seconds):
            events.append(("complete", iteration_id))

    class _Writer:
   100|        async def send_stats_and_wait(self, stats_events, *, batch_id, stop_event):
            events.append(("kafka", tuple(event.login for event in stats_events)))

    async def _active_logins(_reader):
        return ["u1", "u2"]

    async def _load_snapshot(login, _stop_event, *, cache):
        return RuntimeUserSnapshot(
            user=NgSteamUser(
                login=login,
   110|                cookies=(NgSteamCookie(name="steamLoginSecure", value="token"),),
                currency_id=8,
            ),
            state_version=1,
        )

    async def _fetch(
        self,
        user,
        *,
   120|        cookie_jar,
        iteration_id,
        bucket_at,
        observed_at,
        stop_event,
    ):
        assert len(tuple(cookie_jar)) == 1
        if user.login == "u1":
            raise RuntimeError("boom")
        return WalletStatsEvent(
   130|            bucket_at=bucket_at,
            observed_at=observed_at,
            login=user.login,
            wallet_minor=100,
            currency_id=8,
            iteration_id=iteration_id,
        )

    monkeypatch.setattr(module, "load_active_user_logins", _active_logins)
    monkeypatch.setattr(module, "load_ng_steam_user_snapshot", _load_snapshot)
   140|    monkeypatch.setattr(module.WalletDaemonRunner, "_fetch_wallet_event", _fetch)
    observer = WalletAnomalyObserver(
        capture=lambda label, **kwargs: captures.append((label, kwargs))
    )
    runner = module.WalletDaemonRunner(
        store=_Store(),
        active_login_reader=object(),
        auth_cache=object(),
        wallet_cache=object(),
        writer=_Writer(),
   150|        concurrency=2,
        observer=observer,
    )
    stop_event = asyncio.Event()

    asyncio.run(runner._run_iteration_once(stop_event))

    assert ("failed", "u1", "Unexpected RuntimeError") in events
    assert ("success", "u2") in events
    assert ("kafka", ("u2",)) in events
   160|    assert events[-1] == ("complete", 42)
    assert captures[0][1]["tags"]["phase"] == "fetch_wallet"
    assert stop_event.is_set() is False


def test_wallet_daemon_recovers_pending_after_iteration_error_before_next_schedule(
    monkeypatch,
) -> None:
    from superbot_ng.platform.runtime import ExpectedShutdown
    from superbot_ng.workers.wallet import daemon as module
   170|
    events: list[tuple[str, int | str | None]] = []

    class _Store:
        async def mark_unfinished_iterations_failed(self, *, message):
            events.append(("mark_unfinished", message))

        async def complete_ready_iterations(self, *, interval_seconds):
            events.append(("complete_ready", interval_seconds))

   180|    class _Runner(module.WalletDaemonRunner):
        def __init__(self):
            super().__init__(
                store=_Store(),
                active_login_reader=object(),
                auth_cache=object(),
                wallet_cache=object(),
                writer=object(),
                interval_seconds=900,
            )
   190|            self.iterations = 0

        async def _run_iteration_once(self, stop_event):
            self.iterations += 1
            events.append(("iteration", self.iterations))
            if self.iterations == 1:
                raise RuntimeError("iteration failed after kafka send")
            stop_event.set()
            raise ExpectedShutdown()

   200|    async def _flush_pending_stats(_store, _writer, _stop_event):
        events.append(("flush_pending", None))

    async def _next_wallet_wake_at(_store):
        events.append(("schedule", None))
        return None

    async def _sleep_or_stop(seconds, _stop_event):
        events.append(("retry_sleep", int(seconds)))
        return False
   210|
    monkeypatch.setattr(module, "flush_pending_stats", _flush_pending_stats)
    monkeypatch.setattr(module.wallet_scheduler, "next_wallet_wake_at", _next_wallet_wake_at)
    monkeypatch.setattr(module, "sleep_or_stop", _sleep_or_stop)

    with pytest.raises(ExpectedShutdown):
        asyncio.run(_Runner().run(asyncio.Event()))

    assert events == [
        ("mark_unfinished", "wallet daemon restarted"),
   220|        ("flush_pending", None),
        ("complete_ready", 900),
        ("schedule", None),
        ("iteration", 1),
        ("retry_sleep", 30),
        ("flush_pending", None),
        ("complete_ready", 900),
        ("schedule", None),
        ("iteration", 2),
    ]
   230|

def test_wallet_system_failure_still_propagates(monkeypatch) -> None:
    from http.cookiejar import CookieJar

    from superbot_ng.platform.runtime import ExpectedShutdown
    from superbot_ng.workers.wallet.login_sync import sync_wallet_login
    from superbot_ng.workers.wallet.observer import WalletAnomalyObserver

    class _Store:
   240|        async def record_failure(self, **_kwargs):
            raise RuntimeError("postgres unavailable")

    class _Runner:
        store = _Store()
        auth_cache = object()
        interval_seconds = 900
        observer = WalletAnomalyObserver(capture=lambda *_args, **_kwargs: None)
        cookie_jars = SimpleNamespace(resolve=lambda _user, _version: CookieJar())

   250|        async def _fetch_wallet_event(self, *_args, **_kwargs):
            raise RuntimeError("user failure")

    class _User:
        login = "u1"

        def proxy_key(self) -> str:
            return "11"

    async def _load_user(*_args, **_kwargs):
   260|        return SimpleNamespace(user=_User(), state_version=1)

    with pytest.raises(RuntimeError, match="postgres unavailable"):
        asyncio.run(
            sync_wallet_login(
                _Runner(),
                "u1",
                iteration_id=1,
                bucket_at=datetime.now(UTC),
                stop_event=asyncio.Event(),
   270|                snapshot_loader=_load_user,
            )
        )

    async def _shutdown(*_args, **_kwargs):
        raise ExpectedShutdown()

    with pytest.raises(ExpectedShutdown):
        asyncio.run(
            sync_wallet_login(
   280|                _Runner(),
                "u1",
                iteration_id=1,
                bucket_at=datetime.now(UTC),
                stop_event=asyncio.Event(),
                snapshot_loader=_shutdown,
            )
        )


   290|def test_wallet_429_is_recorded_without_sentry() -> None:
    from http.cookiejar import CookieJar

    from superbot_ng.clients.steam.wallet import WalletRateLimitDefer
    from superbot_ng.workers.wallet.login_sync import sync_wallet_login
    from superbot_ng.workers.wallet.observer import WalletAnomalyObserver

    captures: list[object] = []
    failures: list[dict[str, object]] = []

   300|    class _Store:
        async def record_failure(self, **kwargs):
            failures.append(kwargs)
            return 9

    class _Runner:
        store = _Store()
        auth_cache = object()
        interval_seconds = 900
        observer = WalletAnomalyObserver(
   310|            capture=lambda *_args, **_kwargs: captures.append("capture")
        )
        cookie_jars = SimpleNamespace(resolve=lambda _user, _version: CookieJar())

        async def _fetch_wallet_event(self, *_args, **_kwargs):
            raise WalletRateLimitDefer(retry_after_seconds=60)

    class _User:
        login = "u1"

   320|        def proxy_key(self) -> str:
            return "11"

    async def _load_user(*_args, **_kwargs):
        return SimpleNamespace(user=_User(), state_version=1)

    result = asyncio.run(
        sync_wallet_login(
            _Runner(),
            "u1",
   330|            iteration_id=1,
            bucket_at=datetime.now(UTC),
            stop_event=asyncio.Event(),
            snapshot_loader=_load_user,
        )
    )

    assert result is None
    assert failures[0]["retry_after_seconds"] == 60
    assert captures == []
   340|

def test_wallet_observer_applies_threshold_cooldown_and_safe_tags() -> None:
    from superbot_ng.workers.wallet.observer import WalletAnomalyObserver

    now = [100.0]
    captures: list[tuple[object, ...]] = []
    observer = WalletAnomalyObserver(
        controlled_threshold=5,
        cooldown_seconds=600,
   350|        capture=lambda label, **kwargs: captures.append((label, kwargs)),
        clock=lambda: now[0],
    )

    observer.record_controlled(
        login="u1",
        phase="fetch_wallet",
        proxy_key="11",
        error_code="http_500",
        retry_count=4,
   360|    )
    observer.record_controlled(
        login="u1",
        phase="fetch_wallet",
        proxy_key="11",
        error_code="http_500",
        retry_count=5,
    )
    observer.record_controlled(
        login="u2",
   370|        phase="fetch_wallet",
        proxy_key="11",
        error_code="http_500",
        retry_count=6,
    )
    now[0] += 600
    observer.record_controlled(
        login="u2",
        phase="fetch_wallet",
        proxy_key="11",
   380|        error_code="http_500",
        retry_count=7,
    )

    assert len(captures) == 2
    tags = captures[0][1]["tags"]
    assert tags == {
        "component": "wallet_worker",
        "phase": "fetch_wallet",
        "error_code": "http_500",
   390|        "proxy_key": "11",
    }
    assert "cookie" not in str(captures).lower()
    assert "password" not in str(captures).lower()


def test_wallet_daemon_captures_repeated_iteration_error_once(monkeypatch) -> None:
    from superbot_ng.workers.wallet import daemon as module
    from superbot_ng.workers.wallet.observer import WalletAnomalyObserver

   400|    captures: list[tuple[object, ...]] = []
    retries = 0

    class _Store:
        async def mark_unfinished_iterations_failed(self, *, message):
            return None

        async def complete_ready_iterations(self, *, interval_seconds):
            return None

   410|    async def _flush(_store, _writer, _stop_event):
        return None

    async def _sleep_until(self, _stop_event):
        return False

    async def _iteration(self, _stop_event):
        raise RuntimeError("database unavailable")

    async def _sleep(_seconds, _stop_event):
   420|        nonlocal retries
        retries += 1
        return retries >= 2

    async def _log(*_args):
        return None

    monkeypatch.setattr(module, "flush_pending_stats", _flush)
    monkeypatch.setattr(module.WalletDaemonRunner, "_sleep_until_next_run", _sleep_until)
    monkeypatch.setattr(module.WalletDaemonRunner, "_run_iteration_once", _iteration)
   430|    monkeypatch.setattr(module, "sleep_or_stop", _sleep)
    monkeypatch.setattr(module, "log_cyan", _log)
    monkeypatch.setattr(module, "log_red", _log)
    observer = WalletAnomalyObserver(
        capture=lambda label, **kwargs: captures.append((label, kwargs)),
        clock=lambda: 100.0,
    )
    runner = module.WalletDaemonRunner(
        store=_Store(),
        active_login_reader=object(),
   440|        auth_cache=object(),
        wallet_cache=object(),
        writer=object(),
        observer=observer,
    )

    asyncio.run(runner.run(asyncio.Event()))

    assert retries == 2
    assert len(captures) == 1
   450|    assert captures[0][1]["tags"]["component"] == "wallet_daemon"


def test_wallet_429_marker_is_written_before_proxy_lock_release(monkeypatch) -> None:
    from http.cookiejar import CookieJar

    from superbot_ng.clients.steam.wallet import WalletRateLimitDefer
    from superbot_ng.clients.steam.wallet import client as module
    from superbot_ng.domain.users import NgProxy, NgSteamCookie, NgSteamUser
    from superbot_ng.platform.proxy_lock import AsyncProxyLockRegistry
   460|
    class _Cooldown:
        limited = False
        checks = 0
        marks = 0

        async def is_addfunds_rate_limited(self, _proxy_key):
            self.checks += 1
            return self.limited

   470|        async def mark_addfunds_rate_limited(self, _proxy_key, *, ttl_seconds):
            assert ttl_seconds == 60
            await asyncio.sleep(0)
            self.marks += 1
            self.limited = True

    class _Http:
        calls = 0

        def __init__(self, **_kwargs):
   480|            return None

        async def get_text(self, _path):
            self.__class__.calls += 1
            await asyncio.sleep(0)
            return SimpleNamespace(status_code=429, text="")

        async def aclose(self):
            return None

   490|    async def _no_sleep(_seconds, _stop_event):
        return False

    monkeypatch.setattr(module, "AsyncBaseHttpClient", _Http)
    monkeypatch.setattr(module, "sleep_or_stop", _no_sleep)
    cooldown = _Cooldown()
    registry = AsyncProxyLockRegistry()
    user = NgSteamUser(
        login="u1",
        proxy=NgProxy(address="11.22.33.44:8080"),
   500|        cookies=(
            NgSteamCookie(
                name="steamLoginSecure",
                value="token",
                domain=".steampowered.com",
            ),
        ),
        currency_id=8,
    )
    cookie_jar = CookieJar()
   510|    clients = [
        module.AsyncSteamWalletClient(
            user,
            cookie_jar=cookie_jar,
            expected_currency_code="JPY",
            cooldown_cache=cooldown,
            lock_registry=registry,
        )
        for _ in range(12)
    ]
   520|
    async def _run() -> None:
        async def _fetch(client) -> None:
            with pytest.raises(WalletRateLimitDefer):
                await client.fetch_wallet(stop_event=asyncio.Event())

        await asyncio.gather(*(_fetch(client) for client in clients))

    asyncio.run(_run())

   530|    assert _Http.calls == 1
    assert cooldown.marks == 1
    assert cooldown.checks == 12


def test_wallet_active_cooldown_skips_http(monkeypatch) -> None:
    from http.cookiejar import CookieJar

    from superbot_ng.clients.steam.wallet import WalletRateLimitDefer
    from superbot_ng.clients.steam.wallet import client as module
   540|    from superbot_ng.domain.users import NgProxy, NgSteamCookie, NgSteamUser
    from superbot_ng.platform.proxy_lock import AsyncProxyLockRegistry

    class _Cooldown:
        async def is_addfunds_rate_limited(self, _proxy_key):
            return True

        async def mark_addfunds_rate_limited(self, _proxy_key, *, ttl_seconds):
            raise AssertionError("unexpected mark")

   550|    class _Http:
        def __init__(self, **_kwargs):
            return None

        async def get_text(self, _path):
            raise AssertionError("unexpected HTTP")

        async def aclose(self):
            return None

   560|    monkeypatch.setattr(module, "AsyncBaseHttpClient", _Http)
    user = NgSteamUser(
        login="u1",
        proxy=NgProxy(address="11.22.33.44:8080"),
        cookies=(NgSteamCookie(name="steamLoginSecure", value="token"),),
        currency_id=8,
    )
    client = module.AsyncSteamWalletClient(
        user,
        cookie_jar=CookieJar(),
   570|        expected_currency_code="JPY",
        cooldown_cache=_Cooldown(),
        lock_registry=AsyncProxyLockRegistry(),
    )

    with pytest.raises(WalletRateLimitDefer):
        asyncio.run(client.fetch_wallet(stop_event=asyncio.Event()))

```
