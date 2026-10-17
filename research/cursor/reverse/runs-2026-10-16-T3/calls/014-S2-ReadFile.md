# ReadFile  (S2, first seen in request 17, call_id call_dfef0186ebe944799673fc7aadc61bbb, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/failures.py"}
```

## Output

```
from __future__ import annotations

from typing import Any

from superbot_ng.clients.steam.wallet import WalletResponseError
from superbot_ng.platform.logging import log_yellow

WALLET_FAILURE_RETRY_SECONDS = 30

    10|
async def record_controlled_failure(
    runner: Any,
    user: Any,
    iteration_id: int,
    exc: WalletResponseError,
) -> None:
    retry_count = await record_wallet_failure(
        runner,
        user.login,
    20|        iteration_id,
        str(exc),
        WALLET_FAILURE_RETRY_SECONDS,
    )
    runner.observer.record_controlled(
        login=user.login,
        phase="fetch_wallet",
        proxy_key=user.proxy_key(),
        error_code=exc.code,
        retry_count=retry_count,
    30|    )


async def record_unexpected_failure(
    runner: Any,
    login: str,
    iteration_id: int,
    phase: str,
    proxy_key: str,
    exc: Exception,
    40|) -> None:
    runner.observer.record_unexpected(
        login=login,
        phase=phase,
        proxy_key=proxy_key,
        exc=exc,
    )
    await record_wallet_failure(
        runner,
        login,
    50|        iteration_id,
        f"Unexpected {type(exc).__name__}",
        WALLET_FAILURE_RETRY_SECONDS,
    )


async def record_wallet_failure(
    runner: Any,
    login: str,
    iteration_id: int,
    60|    message: str,
    retry_after_seconds: int,
) -> int:
    retry_count = await runner.store.record_failure(
        login=login,
        iteration_id=iteration_id,
        message=message,
        retry_after_seconds=retry_after_seconds,
    )
    await log_yellow("WalletSync", login, message)
    70|    return int(retry_count)

```
