# Glob  (S2, first seen in request 28, call_id call_29bc8736d1fd434db38b49e64bd0210c, item type function_call)

## Arguments

```
{"glob_pattern":"**/*wallet*"}
```

## Output

```
Result of search in '.' (total 57 files):
- src/superbot_ng/workers/wallet/observer.py
- tests/contracts/wallet/test_wallet_backlog_contracts.py
- tests/contracts/wallet/test_wallet_ng_contracts.py
- src/superbot_ng/workers/wallet/__init__.py
- src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py
- tests/contracts/wallet/test_wallet_failure_contracts.py
- rust/crates/steam_wallet/src/lib.rs
- src/superbot_ng/clients/steam/wallet/client.py
- src/superbot_ng/pipelines/wallet/codec.py
- src/superbot_ng/repositories/redis/wallet/cache.py
- src/superbot_ng/workers/wallet/login_sync.py
- migrations/postgres/000012_wallet_due_scheduler.sql
- migrations/clickhouse/000003_wallet_stats_events.sql
- aWalletSync.py
- src/superbot_ng/entrypoints/wallet/runner.py
- src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py
- rust/services/wallet_sync/src/lib.rs
- rust/services/wallet_sync/src/model.rs
- src/superbot_ng/repositories/postgres/wallet/store_sync_results.py
- src/superbot_ng/domain/wallet/__init__.py
- src/superbot_ng/repositories/redis/wallet/__init__.py
- src/superbot_ng/workers/wallet/iteration.py
- migrations/postgres/000007_wallet_sync.sql
- src/superbot_ng/workers/wallet/fetch_event.py
- rust/services/wallet_sync/src/session.rs
- src/superbot_ng/repositories/postgres/wallet/store_roster.py
- migrations/clickhouse/000011_wallet_daily_without_final.sql
- src/superbot_ng/clients/kafka/wallet/payload.py
- rust/services/wallet_sync/src/main.rs
- rust/services/wallet_sync/src/config.rs
- src/superbot_ng/workers/wallet/daemon.py
- src/superbot_ng/repositories/postgres/wallet/store_stats.py
- src/superbot_ng/repositories/postgres/wallet/store_stats_sql.py
- src/superbot_ng/workers/wallet/pending.py
- src/superbot_ng/clients/steam/wallet/__init__.py
- rust/services/wallet_sync/src/kafka.rs
- src/superbot_ng/repositories/postgres/wallet/store.py
- src/superbot_ng/pipelines/wallet/__init__.py
- tests/contracts/wallet/test_wallet_scheduler_contracts.py
- src/superbot_ng/repositories/postgres/wallet/store_iterations.py
- src/superbot_ng/domain/wallet/models.py
- src/superbot_ng/workers/wallet/failures.py
- rust/services/wallet_sync/src/store.rs
- src/superbot_ng/ports/wallet/cooldown.py
- migrations/clickhouse/000013_wallet_daily_two_day_window.sql
- src/superbot_ng/repositories/postgres/wallet/__init__.py
- src/superbot_ng/ports/wallet/__init__.py
- src/superbot_ng/clients/kafka/wallet/__init__.py
- src/superbot_ng/workers/wallet/scheduler.py
- src/superbot_ng/entrypoints/wallet/__init__.py
- rust/services/wallet_sync/src/daemon.rs
- src/superbot_ng/pipelines/wallet/envelope.py
- rust/services/wallet_sync/Cargo.toml
- rust/crates/steam_wallet/Cargo.toml
- src/superbot_ng/use_cases/stats/wallet_conversion.py
- src/superbot_ng/clients/steam/wallet/errors.py
- src/superbot_ng/clients/kafka/wallet/wallet_writer.py

```
