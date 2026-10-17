# ReadFile  (S4, first seen in request 54, call_id call_9f0133a3f78e4a2ebbac3b0833c2f7e0, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/failures.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nfrom typing import Any\n\nfrom superbot_ng.clients.steam.wallet import WalletResponseError\nfrom superbot_ng.platform.logging import log_yellow\n\nWALLET_FAILURE_RETRY_SECONDS = 30\n\n    10|\nasync def record_controlled_failure(\n    runner: Any,\n    user: Any,\n    iteration_id: int,\n    exc: WalletResponseError,\n) -> None:\n    retry_count = await record_wallet_failure(\n        runner,\n        user.login,\n    20|        iteration_id,\n        str(exc),\n        WALLET_FAILURE_RETRY_SECONDS,\n    )\n    runner.observer.record_controlled(\n        login=user.login,\n        phase=\"fetch_wallet\",\n        proxy_key=user.proxy_key(),\n        error_code=exc.code,\n        retry_count=retry_count,\n    30|    )\n\n\nasync def record_unexpected_failure(\n    runner: Any,\n    login: str,\n    iteration_id: int,\n    phase: str,\n    proxy_key: str,\n    exc: Exception,\n    40|) -> None:\n    runner.observer.record_unexpected(\n        login=login,\n        phase=phase,\n        proxy_key=proxy_key,\n        exc=exc,\n    )\n    await record_wallet_failure(\n        runner,\n        login,\n    50|        iteration_id,\n        f\"Unexpected {type(exc).__name__}\",\n        WALLET_FAILURE_RETRY_SECONDS,\n    )\n\n\nasync def record_wallet_failure(\n    runner: Any,\n    login: str,\n    iteration_id: int,\n    60|    message: str,\n    retry_after_seconds: int,\n) -> int:\n    retry_count = await runner.store.record_failure(\n        login=login,\n        iteration_id=iteration_id,\n        message=message,\n        retry_after_seconds=retry_after_seconds,\n    )\n    await log_yellow(\"WalletSync\", login, message)\n    70|    return int(retry_count)\n", "type": "input_text"}]
```
