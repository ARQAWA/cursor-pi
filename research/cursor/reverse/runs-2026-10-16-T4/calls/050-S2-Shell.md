# Shell  (S2, first seen in request 51, call_id call_8844f91c97774398a5a277308ca19156, item type function_call)

## Arguments

```
{"command":"python3 - <<'PY'\nimport ast\nimport asyncio\nfrom datetime import UTC, datetime, timedelta\nfrom pathlib import Path\nfrom types import SimpleNamespace\n\npath = Path('src/superbot_ng/workers/wallet/scheduler.py')\ntree = ast.parse(path.read_text())\nnode = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == '_load_due_work')\nnamespace = {'Any': object, 'datetime': datetime, 'WalletIterationKind': str, 'WALLET_RETRY_BATCH_SIZE': 1000}\nexec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)\nnow = datetime(2026, 10, 16, 10, 0, tzinfo=UTC)\nclass Store:\n    def __init__(self, full_at):\n        self.full_at = full_at\n    async def latest_next_run_at(self):\n        return self.full_at\n    async def due_retry_logins(self, *, now, limit):\n        # Untouched wallet: active=True, next_attempt_at <= now, last_error=None.\n        return []\nasync def active(_):\n    return ['processed', 'untouched']\nasync def main():\n    for label, full_at in [('previous full still scheduled', now + timedelta(minutes=10)), ('previous full overdue', now - timedelta(minutes=1))]:\n        runner = SimpleNamespace(store=Store(full_at), active_login_reader=None)\n        result = await namespace['_load_due_work'](runner, active, now)\n        print(f'{label}: {result!r}')\nasyncio.run(main())\nPY","description":"Reproduce scheduler omission without external services"}
```

## Output

```
[{"text": "Exit code: 0\n\nCommand output:\n\n```\nprevious full still scheduled: None\nprevious full overdue: ('full', ['processed', 'untouched'])\n\n```\n\nCommand completed in 1278 ms.\n\nShell state (cwd, env vars) persists for subsequent calls.", "type": "input_text"}]
```
