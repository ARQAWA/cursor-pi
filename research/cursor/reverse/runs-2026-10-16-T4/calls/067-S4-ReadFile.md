# ReadFile  (S4, first seen in request 69, call_id call_5b7b0d9f709b43e0b5507dba09d0d8e5, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/settings/runtime.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nfrom typing import Final\n\nAUTH_RETRY_SLEEP: Final[int] = 30\nAUTH_TTL_THRESHOLD_SEC: Final[int] = 400\nAUTH_REDIS_READ_CONCURRENCY: Final[int] = 8\nSALES_HISTORY_SYNC_INTERVAL_SEC: Final[int] = 900\nSALES_HISTORY_DAEMON_ACCOUNT_CONCURRENCY: Final[int] = 12\n    10|SALES_HISTORY_RAW_CONCURRENCY: Final[int] = 12\nSALES_HISTORY_MARKING_CONCURRENCY: Final[int] = 4\nSALES_HISTORY_MARK_QUEUE_SIZE: Final[int] = (\n    SALES_HISTORY_RAW_CONCURRENCY + SALES_HISTORY_MARKING_CONCURRENCY\n)\nSALES_HISTORY_TRANSCODE_WORKERS: Final[int] = 2\nSALES_HISTORY_CONVERSION_QUEUE_SIZE: Final[int] = 64\nSALES_HISTORY_KAFKA_PAYLOAD_MAX_BYTES: Final[int] = 512 * 1024\nWALLET_SYNC_INTERVAL_SEC: Final[int] = 900\nWALLET_SYNC_CONCURRENCY: Final[int] = 12\n    20|WALLET_STATS_KAFKA_PAYLOAD_MAX_BYTES: Final[int] = 128 * 1024\nWALLET_CURRENCY_ID: Final[int] = 8\nWALLET_CURRENCY_CODE: Final[str] = \"JPY\"\nCURRENCY_SYNC_BASE_LOGIN: Final[str] = \"hoppertty\"\nCURRENCY_SYNC_INTERVAL_SEC: Final[int] = 2400\nCURRENCY_SYNC_RETRY_SEC: Final[int] = 60\nCLICKHOUSE_HTTP_RETRY_ATTEMPTS: Final[int] = 3\nCLICKHOUSE_HTTP_RETRY_SLEEP_SEC: Final[float] = 0.25\n", "type": "input_text"}]
```
