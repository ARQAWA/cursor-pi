# ReadFile  (S4, first seen in request 63, call_id call_230dae05967d4cffb341c15bed4f36be, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/entrypoints/wallet/runner.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nimport asyncio\n\nfrom superbot_ng.clients.kafka.wallet import WalletKafkaWriter\nfrom superbot_ng.platform.logging import shutdown_logging\nfrom superbot_ng.platform.runtime import install_async_stop_handlers\nfrom superbot_ng.repositories.postgres.auth import AuthPostgresStore\nfrom superbot_ng.repositories.postgres.wallet import WalletPostgresStore\n    10|from superbot_ng.repositories.redis.auth import AuthRedisCache\nfrom superbot_ng.repositories.redis.wallet import WalletRedisCache\nfrom superbot_ng.workers.wallet import WalletDaemonRunner\n\n\nasync def run_wallet_daemon() -> None:\n    stop_event = asyncio.Event()\n    install_async_stop_handlers(stop_event)\n    auth_store = await AuthPostgresStore.create()\n    store = await WalletPostgresStore.create()\n    20|    auth_cache = await AuthRedisCache.create()\n    wallet_cache = await WalletRedisCache.create()\n    writer = WalletKafkaWriter()\n    await writer.start()\n    try:\n        runner = WalletDaemonRunner(\n            store=store,\n            active_login_reader=auth_store,\n            auth_cache=auth_cache,\n            wallet_cache=wallet_cache,\n    30|            writer=writer,\n        )\n        await runner.run(stop_event)\n    finally:\n        await writer.stop()\n        await wallet_cache.aclose()\n        await auth_cache.aclose()\n        await store.aclose()\n        await auth_store.aclose()\n        await shutdown_logging()\n    40|", "type": "input_text"}]
```
