# ReadFile  (S3, first seen in request 26, call_id call_8a6ca09495de413193587222627935b0, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/daemon.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from http.cookiejar import CookieJar

from superbot_ng.clients.kafka.wallet import WalletKafkaWriter
from superbot_ng.clients.steam import SteamCookieJarRegistry
from superbot_ng.domain.users import NgSteamUser
    10|from superbot_ng.domain.wallet import WalletStatsEvent
from superbot_ng.platform import settings
from superbot_ng.platform.logging import log_cyan, log_red
from superbot_ng.platform.runtime import ExpectedShutdown, sleep_or_stop
from superbot_ng.ports.users import ActiveLoginReader
from superbot_ng.repositories.postgres.wallet import WalletPostgresStore
from superbot_ng.repositories.redis.auth import AuthRedisCache
from superbot_ng.repositories.redis.wallet import WalletRedisCache
from superbot_ng.use_cases.users import load_active_user_logins, load_ng_steam_user_snapshot
from superbot_ng.workers.wallet import scheduler as wallet_scheduler
    20|from superbot_ng.workers.wallet.fetch_event import fetch_wallet_event
from superbot_ng.workers.wallet.login_sync import sync_wallet_login
from superbot_ng.workers.wallet.observer import WalletAnomalyObserver
from superbot_ng.workers.wallet.pending import flush_pending_stats


class WalletDaemonRunner:
    def __init__(
        self,
        *,
    30|        store: WalletPostgresStore,
        active_login_reader: ActiveLoginReader,
        auth_cache: AuthRedisCache,
        wallet_cache: WalletRedisCache,
        writer: WalletKafkaWriter,
        interval_seconds: int = settings.WALLET_SYNC_INTERVAL_SEC,
        concurrency: int = settings.WALLET_SYNC_CONCURRENCY,
        currency_id: int = settings.WALLET_CURRENCY_ID,
        currency_code: str = settings.WALLET_CURRENCY_CODE,
        observer: WalletAnomalyObserver | None = None,
    40|    ) -> None:
        self.store = store
        self.active_login_reader = active_login_reader
        self.auth_cache = auth_cache
        self.wallet_cache = wallet_cache
        self.writer = writer
        self.interval_seconds = int(interval_seconds)
        self.concurrency = int(concurrency)
        self.currency_id = int(currency_id)
        self.currency_code = str(currency_code)
    50|        self.observer = observer or WalletAnomalyObserver()
        self.cookie_jars = SteamCookieJarRegistry("store.steampowered.com")

    async def run(self, stop_event: asyncio.Event) -> None:
        await log_cyan(
            "WalletSync|started|"
            f"interval={self.interval_seconds}|workers={self.concurrency}|"
            f"currency={self.currency_code}"
        )
        await self.store.mark_unfinished_iterations_failed(message="wallet daemon restarted")
    60|        while not stop_event.is_set():
            await flush_pending_stats(self.store, self.writer, stop_event)
            await self.store.complete_ready_iterations(interval_seconds=self.interval_seconds)
            if await self._sleep_until_next_run(stop_event):
                break
            try:
                await self._run_iteration_once(stop_event)
            except ExpectedShutdown:
                raise
            except Exception as exc:
    70|                self.observer.record_iteration(exc)
                await log_red(f"WalletSync|iteration_error|{type(exc).__name__}: {exc}")
                if await sleep_or_stop(30, stop_event):
                    break

    async def _sleep_until_next_run(self, stop_event: asyncio.Event) -> bool:
        next_run_at = await wallet_scheduler.next_wallet_wake_at(self.store)
        if next_run_at is None:
            return False
        seconds = (next_run_at - datetime.now(UTC)).total_seconds()
    80|        if seconds <= 0:
            return False
        await log_cyan(f"WalletSync|sleep|seconds={int(seconds)}")
        return await sleep_or_stop(seconds, stop_event)

    async def _run_iteration_once(self, stop_event: asyncio.Event) -> None:
        await wallet_scheduler.run_due_wallet_iteration(
            self,
            stop_event,
            active_login_loader=load_active_user_logins,
    90|        )

    async def _sync_one(
        self,
        login: str,
        *,
        iteration_id: int,
        bucket_at: datetime,
        stop_event: asyncio.Event,
    ) -> WalletStatsEvent | None:
   100|        return await sync_wallet_login(
            self,
            login,
            iteration_id=iteration_id,
            bucket_at=bucket_at,
            stop_event=stop_event,
            snapshot_loader=load_ng_steam_user_snapshot,
        )

    async def _fetch_wallet_event(
   110|        self,
        user: NgSteamUser,
        *,
        cookie_jar: CookieJar,
        iteration_id: int,
        bucket_at: datetime,
        observed_at: datetime,
        stop_event: asyncio.Event,
    ) -> WalletStatsEvent:
        return await fetch_wallet_event(
   120|            user,
            cookie_jar=cookie_jar,
            wallet_cache=self.wallet_cache,
            currency_id=self.currency_id,
            currency_code=self.currency_code,
            iteration_id=iteration_id,
            bucket_at=bucket_at,
            observed_at=observed_at,
            stop_event=stop_event,
        )
   130|
```
