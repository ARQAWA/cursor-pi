# Glob  (S3, first seen in request 23, call_id call_19baa86b3691401c8b59ec5493dc9df5, item type function_call)

## Arguments

```
{"glob_pattern":"**/*wallet*/*.py"}
```

## Output

```
Result of search in '.' (total 39 files):
- src/superbot_ng/domain/wallet/__init__.py
- src/superbot_ng/domain/wallet/models.py
- src/superbot_ng/workers/wallet/daemon.py
- src/superbot_ng/workers/wallet/scheduler.py
- src/superbot_ng/workers/wallet/fetch_event.py
- src/superbot_ng/workers/wallet/failures.py
- src/superbot_ng/workers/wallet/pending.py
- src/superbot_ng/workers/wallet/__init__.py
- src/superbot_ng/workers/wallet/login_sync.py
- src/superbot_ng/pipelines/wallet/envelope.py
- src/superbot_ng/workers/wallet/iteration.py
- src/superbot_ng/workers/wallet/observer.py
- src/superbot_ng/pipelines/wallet/codec.py
- src/superbot_ng/pipelines/wallet/__init__.py
- src/superbot_ng/clients/kafka/wallet/wallet_writer.py
- src/superbot_ng/clients/kafka/wallet/payload.py
- src/superbot_ng/clients/kafka/wallet/__init__.py
- src/superbot_ng/repositories/postgres/wallet/store_sync_results.py
- src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py
- src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py
- src/superbot_ng/repositories/postgres/wallet/__init__.py
- src/superbot_ng/repositories/postgres/wallet/store_stats.py
- src/superbot_ng/repositories/postgres/wallet/store_stats_sql.py
- src/superbot_ng/repositories/postgres/wallet/store_iterations.py
- src/superbot_ng/repositories/postgres/wallet/store_roster.py
- src/superbot_ng/repositories/postgres/wallet/store.py
- src/superbot_ng/ports/wallet/__init__.py
- src/superbot_ng/ports/wallet/cooldown.py
- src/superbot_ng/clients/steam/wallet/errors.py
- src/superbot_ng/clients/steam/wallet/__init__.py
- src/superbot_ng/clients/steam/wallet/client.py
- src/superbot_ng/entrypoints/wallet/__init__.py
- src/superbot_ng/entrypoints/wallet/runner.py
- src/superbot_ng/repositories/redis/wallet/__init__.py
- src/superbot_ng/repositories/redis/wallet/cache.py
- tests/contracts/wallet/test_wallet_failure_contracts.py
- tests/contracts/wallet/test_wallet_backlog_contracts.py
- tests/contracts/wallet/test_wallet_ng_contracts.py
- tests/contracts/wallet/test_wallet_scheduler_contracts.py

```
