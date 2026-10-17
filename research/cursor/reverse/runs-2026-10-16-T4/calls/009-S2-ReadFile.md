# ReadFile  (S2, first seen in request 9, call_id call_cb30f5854ffc4020a73d87b77ceae1d4, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/aWalletSync.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nimport asyncio\nimport sys\nfrom pathlib import Path\n\nsys.path.insert(0, str(Path(__file__).resolve().parent / \"src\"))\n\nfrom superbot_ng.entrypoints.wallet import run_wallet_daemon\n    10|from superbot_ng.platform.observability import capture_exception, init_sentry\nfrom superbot_ng.platform.runtime import (\n    AlreadyRunning,\n    ExpectedShutdown,\n    FileLock,\n    SINGLETON_ALREADY_RUNNING_EXIT_CODE,\n)\n\n\ndef main() -> int:\n    20|    init_sentry()\n    try:\n        with FileLock(\"wallet_sync\"):\n            asyncio.run(run_wallet_daemon())\n    except AlreadyRunning as exc:\n        print(f\"WalletSync|already_running|{exc}\")\n        return SINGLETON_ALREADY_RUNNING_EXIT_CODE\n    except ExpectedShutdown:\n        print(\"WalletSync|stopped\")\n        return 0\n    30|    except KeyboardInterrupt:\n        print(\"WalletSync|stopped\")\n        return 130\n    except Exception:\n        capture_exception(\"WalletSync\")\n        raise\n    return 0\n\n\nif __name__ == \"__main__\":\n    40|    raise SystemExit(main())\n", "type": "input_text"}]
```
