# ReadFile  (S2, first seen in request 25, call_id call_ccdad2c7969643d9ac9bb7e5b250809b, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/login_sync.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from http.cookiejar import CookieJar
from typing import Any, cast

from superbot_ng.clients.steam.wallet import WalletRateLimitDefer, WalletResponseError
from superbot_ng.domain.wallet import WalletStatsEvent
    10|from superbot_ng.platform.logging import log_cyan
from superbot_ng.platform.runtime import ExpectedShutdown
from superbot_ng.workers.wallet.failures import (
    record_controlled_failure,
    record_unexpected_failure,
    record_wallet_failure,
)


async def sync_wallet_login(
    20|    runner: Any,
    login: str,
    *,
    iteration_id: int,
    bucket_at: datetime,
    stop_event: asyncio.Event,
    snapshot_loader: Any,
) -> WalletStatsEvent | None:
    observed_at = datetime.now(UTC)
    runtime = await _load_runtime(runner, login, iteration_id, stop_event, snapshot_loader)
    30|    if runtime is None:
        return None
    user, cookie_jar = runtime
    event = await _fetch_event(
        runner,
        user,
        cookie_jar,
        iteration_id=iteration_id,
        bucket_at=bucket_at,
        observed_at=observed_at,
    40|        stop_event=stop_event,
    )
    if event is None:
        return None
    await runner.store.record_success(
        event,
        next_attempt_at=observed_at + timedelta(seconds=runner.interval_seconds),
    )
    await log_cyan(f"WalletSync|{login}|wallet={event.wallet_minor}|currency={runner.currency_id}")
    return event
    50|

async def _load_runtime(
    runner: Any,
    login: str,
    iteration_id: int,
    stop_event: asyncio.Event,
    snapshot_loader: Any,
) -> tuple[Any, CookieJar] | None:
    try:
    60|        snapshot = await snapshot_loader(login, stop_event, cache=runner.auth_cache)
        cookie_jar = runner.cookie_jars.resolve(snapshot.user, snapshot.state_version)
        return snapshot.user, cookie_jar
    except ExpectedShutdown:
        raise
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        await record_unexpected_failure(runner, login, iteration_id, "load_user", "unknown", exc)
        return None
    70|

async def _fetch_event(
    runner: Any,
    user: Any,
    cookie_jar: CookieJar,
    *,
    iteration_id: int,
    bucket_at: datetime,
    observed_at: datetime,
    80|    stop_event: asyncio.Event,
) -> WalletStatsEvent | None:
    try:
        return cast(
            WalletStatsEvent,
            await runner._fetch_wallet_event(
                user,
                cookie_jar=cookie_jar,
                iteration_id=iteration_id,
                bucket_at=bucket_at,
    90|                observed_at=observed_at,
                stop_event=stop_event,
            ),
        )
    except ExpectedShutdown:
        raise
    except asyncio.CancelledError:
        raise
    except WalletRateLimitDefer as exc:
        await record_wallet_failure(
   100|            runner, user.login, iteration_id, str(exc), exc.retry_after_seconds
        )
    except WalletResponseError as exc:
        await record_controlled_failure(runner, user, iteration_id, exc)
    except Exception as exc:
        await record_unexpected_failure(
            runner, user.login, iteration_id, "fetch_wallet", user.proxy_key(), exc
        )
    return None

```
