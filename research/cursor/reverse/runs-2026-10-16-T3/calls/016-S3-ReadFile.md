# ReadFile  (S3, first seen in request 19, call_id call_1416251f94fb478fb7578465009e736b, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/aWalletSync.py"}
```

## Output

```
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from superbot_ng.entrypoints.wallet import run_wallet_daemon
    10|from superbot_ng.platform.observability import capture_exception, init_sentry
from superbot_ng.platform.runtime import (
    AlreadyRunning,
    ExpectedShutdown,
    FileLock,
    SINGLETON_ALREADY_RUNNING_EXIT_CODE,
)


def main() -> int:
    20|    init_sentry()
    try:
        with FileLock("wallet_sync"):
            asyncio.run(run_wallet_daemon())
    except AlreadyRunning as exc:
        print(f"WalletSync|already_running|{exc}")
        return SINGLETON_ALREADY_RUNNING_EXIT_CODE
    except ExpectedShutdown:
        print("WalletSync|stopped")
        return 0
    30|    except KeyboardInterrupt:
        print("WalletSync|stopped")
        return 130
    except Exception:
        capture_exception("WalletSync")
        raise
    return 0


if __name__ == "__main__":
    40|    raise SystemExit(main())

```
