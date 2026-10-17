# ReadFile  (S3, first seen in request 44, call_id call_db5069795cf54381863869691ffe9ea8, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/fetch_event.py"}
```

## Output

```
[{"text": "from __future__ import annotations\n\nimport asyncio\nfrom datetime import datetime\nfrom http.cookiejar import CookieJar\n\nfrom superbot_ng.clients.steam.wallet import AsyncSteamWalletClient\nfrom superbot_ng.domain.users import NgSteamUser\nfrom superbot_ng.domain.wallet import WalletStatsEvent\n    10|from superbot_ng.repositories.redis.wallet import WalletRedisCache\n\n\nasync def fetch_wallet_event(\n    user: NgSteamUser,\n    *,\n    cookie_jar: CookieJar,\n    wallet_cache: WalletRedisCache,\n    currency_id: int,\n    currency_code: str,\n    20|    iteration_id: int,\n    bucket_at: datetime,\n    observed_at: datetime,\n    stop_event: asyncio.Event,\n) -> WalletStatsEvent:\n    async with AsyncSteamWalletClient(\n        user,\n        cookie_jar=cookie_jar,\n        expected_currency_code=currency_code,\n        cooldown_cache=wallet_cache,\n    30|    ) as client:\n        result = await client.fetch_wallet(stop_event=stop_event)\n    return WalletStatsEvent(\n        bucket_at=bucket_at,\n        observed_at=observed_at,\n        login=user.login,\n        wallet_minor=result.wallet_minor,\n        currency_id=currency_id,\n        iteration_id=iteration_id,\n    )\n    40|", "type": "input_text"}]
```
