# ReadFile  (S3, first seen in request 48, call_id call_d0ceae915584425a838942ebfc68e488, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/runtime/workers.py"}
```

## Output

```
from __future__ import annotations

import asyncio
import contextlib
from collections import deque
from collections.abc import Awaitable, Callable, Iterable
from typing import TypeVar

T = TypeVar("T")
    10|

async def run_bounded_workers[T](
    items: Iterable[T],
    worker: Callable[[T], Awaitable[None]],
    *,
    max_workers: int,
    stop_event: asyncio.Event,
) -> None:
    queue = deque(items)
    20|    if not queue:
        return
    workers_count = min(len(queue), max(1, int(max_workers)))

    async def _runner() -> None:
        while not stop_event.is_set():
            try:
                item = queue.popleft()
            except IndexError:
                return
    30|            await worker(item)

    tasks = [asyncio.create_task(_runner()) for _ in range(workers_count)]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        await _cancel_workers(tasks, stop_event)
        raise


    40|async def _cancel_workers(
    tasks: list[asyncio.Task[None]],
    stop_event: asyncio.Event,
) -> None:
    stop_event.set()
    for task in tasks:
        if not task.done():
            task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError):
    50|            await task

```
