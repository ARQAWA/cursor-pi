# ReadFile  (S3, first seen in request 56, call_id call_f5c6c6d52c9c4307b893d6abf68352ea, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_backlog_contracts.py"}
```

## Output

```
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import orjson
import pytest

    10|from superbot_ng.domain.wallet import WalletStatsEvent


def _event(login: str = "u1", iteration_id: int = 7) -> WalletStatsEvent:
    return WalletStatsEvent(
        bucket_at=datetime(2026, 5, 11, 10, 0, tzinfo=UTC),
        observed_at=datetime(2026, 5, 11, 10, 0, 1, tzinfo=UTC),
        login=login,
        wallet_minor=123400,
        currency_id=8,
    20|        iteration_id=iteration_id,
    )


def test_wallet_small_envelope_keeps_exact_bytes() -> None:
    from superbot_ng.pipelines.wallet import encode_wallet_stats_envelope_chunks

    chunks = encode_wallet_stats_envelope_chunks(
        batch_id='wallet-"-\\',
        events=(_event() for _ in range(1)),
    30|        max_bytes=128 * 1024,
    )

    assert len(chunks) == 1
    assert chunks[0].batch_id == 'wallet-"-\\'
    assert chunks[0].rows == 1
    assert chunks[0].payload == (
        b'{"v":1,"b":"wallet-\\"-\\\\","r":'
        b'[["2026-05-11 10:00:00.000","2026-05-11 10:00:01.000",'
        b'"u1",123400,8,7]]}'
    40|    )


def test_wallet_large_envelope_chunks_once_and_preserves_row_order() -> None:
    from superbot_ng.pipelines.wallet import (
        decode_wallet_stats_envelope,
        encode_wallet_stats_envelope_chunks,
    )

    events = [_event("u1"), _event("u2"), _event("u3")]
    50|    single = encode_wallet_stats_envelope_chunks(
        batch_id="wallet-0001",
        events=events[:1],
        max_bytes=128 * 1024,
    )[0]
    chunks = encode_wallet_stats_envelope_chunks(
        batch_id="wallet",
        events=iter(events),
        max_bytes=len(single.payload),
    )
    60|
    assert [chunk.batch_id for chunk in chunks] == [
        "wallet-0001",
        "wallet-0002",
        "wallet-0003",
    ]
    assert all(len(chunk.payload) <= len(single.payload) for chunk in chunks)
    rows = [row for chunk in chunks for row in decode_wallet_stats_envelope(chunk.payload)["r"]]
    assert [row[2] for row in rows] == ["u1", "u2", "u3"]

    70|
def test_wallet_envelope_keeps_empty_and_oversize_errors() -> None:
    from superbot_ng.pipelines.wallet import encode_wallet_stats_envelope_chunks

    assert (
        encode_wallet_stats_envelope_chunks(
            batch_id="batch",
            events=[],
            max_bytes=0,
        )
    80|        == ()
    )
    with pytest.raises(ValueError, match=r"^wallet stats Kafka payload is too large$"):
        encode_wallet_stats_envelope_chunks(
            batch_id="batch",
            events=[_event()],
            max_bytes=0,
        )


    90|def test_wallet_writer_empty_events_are_terminal_noop() -> None:
    from superbot_ng.clients.kafka.wallet.wallet_writer import WalletKafkaWriter

    class _VisibilityWaiter:
        async def wait(self, _targets, *, stop_event) -> None:
            raise AssertionError("empty wallet events must not wait for Kafka")

    writer = WalletKafkaWriter(visibility_waiter=_VisibilityWaiter())

    assert asyncio.run(writer.send_stats_and_wait([], batch_id="empty")) == ""
   100|

@pytest.mark.parametrize(
    "row,error",
    [
        (["bad", "2026-01-01 00:00:00.000", "u", 1, 1, 1], "bucket_at"),
        (
            ["2026-01-01 00:00:00.000", "2026-01-01 00:00:00.000", "", 1, 1, 1],
            "login",
        ),
   110|        (
            [
                "2026-01-01 00:00:00.000",
                "2026-01-01 00:00:00.000",
                "u",
                2**63,
                1,
                1,
            ],
            "wallet_minor",
   120|        ),
        (
            [
                "2026-01-01 00:00:00.000",
                "2026-01-01 00:00:00.000",
                "u",
                1,
                2**31,
                1,
            ],
   130|            "currency_id",
        ),
        (
            [
                "2026-01-01 00:00:00.000",
                "2026-01-01 00:00:00.000",
                "u",
                1,
                1,
                -1,
   140|            ],
            "iteration_id",
        ),
    ],
)
def test_wallet_codec_rejects_clickhouse_incompatible_rows(row, error) -> None:
    from superbot_ng.pipelines.wallet import encode_wallet_stats_clickhouse_batch

    payload = orjson.dumps({"v": 1, "b": "batch", "r": [row]})
    with pytest.raises(ValueError, match=error):
   150|        encode_wallet_stats_clickhouse_batch(topic="wallet", payloads=[payload])


def test_wallet_raw_empty_rows_are_terminal_noop() -> None:
    from superbot_ng.pipelines.wallet import encode_wallet_stats_clickhouse_batch

    encoded = encode_wallet_stats_clickhouse_batch(
        topic="wallet",
        payloads=[orjson.dumps({"v": 1, "b": "empty", "r": []})],
    )
   160|
    assert encoded.rows == 0
    assert encoded.body == b""


def test_wallet_visibility_requires_committed_offset_after_sent_offset(monkeypatch) -> None:
    from aiokafka.structs import TopicPartition

    from superbot_ng.clients.kafka.visibility import KafkaVisibilityTarget
    from superbot_ng.clients.kafka.visibility import waiter as module
   170|
    partition = TopicPartition("wallet", 0)
    calls: list[int] = []

    class _Admin:
        async def start(self) -> None:
            return None

        async def close(self) -> None:
            return None
   180|
        async def list_consumer_group_offsets(self, _group_id, *, partitions):
            assert partitions == [partition]
            calls.append(len(calls) + 1)
            return {
                partition: SimpleNamespace(
                    offset=7 if len(calls) == 1 else 8,
                )
            }

   190|    monkeypatch.setattr(module, "AIOKafkaAdminClient", lambda **_kwargs: _Admin())
    visibility = module.KafkaVisibilityWaiter(
        initial_poll_seconds=0,
        max_poll_seconds=0,
    )
    asyncio.run(
        visibility.wait(
            [
                KafkaVisibilityTarget(
                    topic="wallet",
   200|                    partition=0,
                    target_offset=7,
                    reason="wallet",
                )
            ],
            stop_event=asyncio.Event(),
        )
    )

    assert calls == [1, 2]
   210|

def test_wallet_writer_keeps_send_visibility_order_and_stops_after_visibility_error(
    monkeypatch,
) -> None:
    from superbot_ng.clients.kafka.visibility import KafkaVisibilityTarget
    from superbot_ng.clients.kafka.wallet import wallet_writer as module
    from superbot_ng.pipelines.wallet import EncodedWalletStatsEnvelopeChunk

    trace: list[str] = []
   220|    chunks = tuple(
        EncodedWalletStatsEnvelopeChunk(f"batch-{index:04d}", b"x", 1) for index in range(1, 4)
    )
    monkeypatch.setattr(module, "encode_wallet_stats_envelope_chunks", lambda **_kwargs: chunks)

    class _VisibilityWaiter:
        async def wait(self, targets, *, stop_event) -> None:
            target = targets[0]
            trace.append(f"visibility:{target.target_offset}")
            if target.target_offset == 2:
   230|                raise RuntimeError("visibility failed")

    writer = module.WalletKafkaWriter(visibility_waiter=_VisibilityWaiter())
    writer._producer = object()

    async def _send(_payload, *, batch_id, rows, stop_event):
        trace.append(f"send:{batch_id}:{rows}")
        return KafkaVisibilityTarget(
            topic="wallet",
            partition=0,
   240|            target_offset=int(batch_id[-1]),
            reason="wallet",
        )

    writer._send_payload = _send

    with pytest.raises(RuntimeError, match="visibility failed"):
        asyncio.run(writer.send_stats_and_wait([_event()], batch_id="batch"))

    assert trace == [
   250|        "send:batch-0001:1",
        "visibility:1",
        "send:batch-0002:1",
        "visibility:2",
    ]


def test_wallet_writer_owns_one_visibility_admin_lifecycle(monkeypatch) -> None:
    from superbot_ng.clients.kafka.visibility import KafkaVisibilityTarget
    from superbot_ng.clients.kafka.wallet import wallet_writer as module
   260|    from superbot_ng.pipelines.wallet import EncodedWalletStatsEnvelopeChunk

    trace: list[str] = []
    chunks = tuple(
        EncodedWalletStatsEnvelopeChunk(f"batch-{index:04d}", b"x", 1) for index in range(1, 4)
    )
    monkeypatch.setattr(module, "encode_wallet_stats_envelope_chunks", lambda **_kwargs: chunks)

    class _Producer:
        async def start(self):
   270|            trace.append("producer:start")

        async def stop(self):
            trace.append("producer:stop")

    class _Waiter:
        async def start(self):
            trace.append("waiter:start")

        async def stop(self):
   280|            trace.append("waiter:stop")

        async def wait(self, targets, *, stop_event):
            trace.append(f"wait:{targets[0].target_offset}")

    monkeypatch.setattr(module, "AIOKafkaProducer", lambda **_kwargs: _Producer())
    monkeypatch.setattr(module, "KafkaVisibilityWaiter", lambda **_kwargs: _Waiter())

    async def _run():
        writer = module.WalletKafkaWriter()
   290|        await writer.start()

        async def _send(_payload, *, batch_id, rows, stop_event):
            trace.append(f"send:{batch_id}")
            return KafkaVisibilityTarget("wallet", 0, int(batch_id[-1]), "wallet")

        writer._send_payload = _send
        await writer.send_stats_and_wait([_event()], batch_id="batch")
        await writer.stop()

   300|    asyncio.run(_run())
    assert trace == [
        "producer:start",
        "waiter:start",
        "send:batch-0001",
        "wait:1",
        "send:batch-0002",
        "wait:2",
        "send:batch-0003",
        "wait:3",
   310|        "producer:stop",
        "waiter:stop",
    ]


def test_wallet_writer_closes_producer_when_visibility_start_fails(monkeypatch) -> None:
    from superbot_ng.clients.kafka.wallet import wallet_writer as module

    trace: list[str] = []

   320|    class _Producer:
        async def start(self):
            trace.append("producer:start")

        async def stop(self):
            trace.append("producer:stop")

    class _Waiter:
        async def start(self):
            trace.append("waiter:start")
   330|            raise RuntimeError("admin unavailable")

        async def stop(self):
            trace.append("waiter:stop")

    monkeypatch.setattr(module, "AIOKafkaProducer", lambda **_kwargs: _Producer())
    monkeypatch.setattr(module, "KafkaVisibilityWaiter", lambda **_kwargs: _Waiter())
    writer = module.WalletKafkaWriter()

    with pytest.raises(RuntimeError, match="admin unavailable"):
   340|        asyncio.run(writer.start())

    assert writer._producer is None
    assert trace == ["producer:start", "waiter:start", "producer:stop"]


def test_wallet_pending_pages_are_marked_only_after_each_page_visibility(
    monkeypatch,
) -> None:
    from superbot_ng.workers.wallet import pending as module
   350|
    page_one = [_event("u1", 1)]
    page_two = [_event("u2", 2)]
    trace: list[object] = []

    class _Store:
        def __init__(self) -> None:
            self.pages = [page_one, page_two, []]

        async def pending_stats_events(self, *, limit: int):
   360|            trace.append(("load", limit))
            return self.pages.pop(0)

        async def mark_stats_synced(self, events):
            trace.append(("mark", events[0].login))

    class _Writer:
        async def send_stats_and_wait(self, events, *, batch_id, stop_event):
            trace.append(("visibility", events[0].login, batch_id))

   370|    async def _log(*_args: object) -> None:
        return None

    monkeypatch.setattr(module, "log_yellow", _log)
    asyncio.run(module.flush_pending_stats(_Store(), _Writer(), asyncio.Event()))

    assert [item[0] for item in trace] == [
        "load",
        "visibility",
        "mark",
   380|        "load",
        "visibility",
        "mark",
        "load",
    ]
    assert trace[0] == ("load", 1000)
    assert str(trace[1][2]).endswith("-p000001")
    assert str(trace[4][2]).endswith("-p000002")


   390|def test_wallet_pending_page_is_not_marked_when_visibility_fails(monkeypatch) -> None:
    from superbot_ng.workers.wallet import pending as module

    trace: list[tuple[str, str]] = []

    class _Store:
        def __init__(self) -> None:
            self.pages = [[_event("u1", 1)], [_event("u2", 2)]]

        async def pending_stats_events(self, *, limit: int):
   400|            assert limit == 1000
            return self.pages.pop(0)

        async def mark_stats_synced(self, events) -> None:
            trace.append(("mark", events[0].login))

    class _Writer:
        async def send_stats_and_wait(self, events, *, batch_id, stop_event) -> None:
            trace.append(("visibility", events[0].login))
            if events[0].login == "u2":
   410|                raise RuntimeError("visibility failed")

    async def _log(*_args: object) -> None:
        return None

    monkeypatch.setattr(module, "log_yellow", _log)
    with pytest.raises(RuntimeError, match="visibility failed"):
        asyncio.run(module.flush_pending_stats(_Store(), _Writer(), asyncio.Event()))

    assert trace == [
   420|        ("visibility", "u1"),
        ("mark", "u1"),
        ("visibility", "u2"),
    ]


def test_wallet_stats_store_uses_bounded_read_and_one_bulk_mark() -> None:
    from superbot_ng.repositories.postgres.wallet.store_stats import WalletStatsMixin
    from superbot_ng.repositories.postgres.wallet.store_stats_sql import (
        MARK_STATS_SYNCED_SQL,
   430|        PENDING_STATS_SQL,
    )

    class _Pool:
        def __init__(self) -> None:
            self.calls: list[tuple[object, ...]] = []

        async def fetch(self, *args: object):
            self.calls.append(("fetch", *args))
            return []
   440|
        async def execute(self, *args: object):
            self.calls.append(("execute", *args))

    class _Store(WalletStatsMixin):
        pass

    async def _run():
        store = _Store()
        store.pool = _Pool()
   450|        await store.pending_stats_events(limit=1000)
        synced_at = datetime(2026, 5, 11, 10, 1, tzinfo=UTC)
        await store.mark_stats_synced(
            [_event("u1", 7), _event("u1", 7), _event("u2", 8)],
            synced_at=synced_at,
        )
        return store.pool.calls

    calls = asyncio.run(_run())

   460|    assert calls[0] == ("fetch", PENDING_STATS_SQL, 1000)
    assert calls[1] == (
        "execute",
        MARK_STATS_SYNCED_SQL,
        ["u1", "u2"],
        [7, 8],
        datetime(2026, 5, 11, 10, 1, tzinfo=UTC),
    )
    assert "LIMIT $1" in PENDING_STATS_SQL
    assert "unnest($1::text[], $2::bigint[])" in MARK_STATS_SYNCED_SQL
   470|

def test_wallet_roster_uses_one_bulk_upsert_before_deactivate() -> None:
    from superbot_ng.repositories.postgres.wallet.store_roster import WalletRosterMixin

    trace: list[tuple[object, ...]] = []

    class _Context:
        def __init__(self, value: object) -> None:
            self.value = value
   480|
        async def __aenter__(self):
            return self.value

        async def __aexit__(self, *_args: object) -> None:
            return None

    class _Connection:
        def transaction(self):
            return _Context(None)
   490|
        async def execute(self, *args: object):
            trace.append(args)

    class _Pool:
        def __init__(self) -> None:
            self.connection = _Connection()

        def acquire(self):
            return _Context(self.connection)
   500|
    class _Store(WalletRosterMixin):
        pass

    async def _run() -> None:
        store = _Store()
        store.pool = _Pool()
        await store.sync_roster(
            ["u1", "u1", "u2"],
            seen_at=datetime(2026, 5, 11, 10, 0, tzinfo=UTC),
   510|        )

    asyncio.run(_run())

    assert len(trace) == 2
    assert trace[0][1] == ["u1", "u1", "u2"]
    assert "unnest($1::text[])" in str(trace[0][0])
    assert str(trace[0][0]).count("$2::timestamptz") == 3
    assert "roster_seen_at < $1" in str(trace[1][0])

```
