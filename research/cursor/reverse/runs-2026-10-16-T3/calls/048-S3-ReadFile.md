# ReadFile  (S3, first seen in request 54, call_id call_ec326f82f76346b1aa9457f5ae32ad0d, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/kafka.rs"}
```

## Output

```
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use rdkafka::{
    ClientConfig,
    consumer::{BaseConsumer, Consumer},
    producer::{FutureProducer, FutureRecord},
    topic_partition_list::TopicPartitionList,
    util::Timeout,
    10|};
use tokio_util::sync::CancellationToken;

use crate::model::{WALLET_STATS_EVENTS_TOPIC, WalletEnvelopeChunk, WalletEvent, encode_chunks};

pub struct WalletKafkaWriter {
    producer: FutureProducer,
    bootstrap_servers: String,
    group_id: String,
    max_bytes: usize,
    20|}
impl WalletKafkaWriter {
    pub fn new(bootstrap_servers: &str, group_id: &str, max_bytes: usize) -> Result<Self> {
        ensure!(
            !bootstrap_servers.trim().is_empty(),
            "wallet Kafka bootstrap servers are empty"
        );
        ensure!(!group_id.trim().is_empty(), "wallet Kafka group is empty");
        let producer = ClientConfig::new()
            .set("bootstrap.servers", bootstrap_servers)
    30|            .set("acks", "all")
            .set("compression.type", "zstd")
            .set("linger.ms", "20")
            .set("batch.size", "65536")
            .create()
            .context("create wallet Kafka producer")?;
        Ok(Self {
            producer,
            bootstrap_servers: bootstrap_servers.to_owned(),
            group_id: group_id.to_owned(),
    40|            max_bytes,
        })
    }
    pub async fn send_and_wait(
        &self,
        events: &[WalletEvent],
        batch_id: &str,
        cancel: &CancellationToken,
    ) -> Result<()> {
        for chunk in encode_chunks(batch_id, events, self.max_bytes)? {
    50|            let checkpoint = self.send(&chunk, cancel).await?;
            self.wait_visible(checkpoint, cancel).await?;
        }
        Ok(())
    }
    async fn send(
        &self,
        chunk: &WalletEnvelopeChunk,
        cancel: &CancellationToken,
    ) -> Result<(String, i32, i64)> {
    60|        let record = FutureRecord::to(WALLET_STATS_EVENTS_TOPIC)
            .key(&chunk.batch_id)
            .payload(&chunk.payload);
        let result = tokio::select! { () = cancel.cancelled() => anyhow::bail!("wallet Kafka send cancelled"), value = self.producer.send(record, Timeout::After(Duration::from_secs(30))) => value.map_err(|(error, _)| anyhow::anyhow!("deliver wallet Kafka payload: {error}"))? };
        Ok((
            WALLET_STATS_EVENTS_TOPIC.to_owned(),
            result.partition,
            result.offset,
        ))
    }
    70|    async fn wait_visible(
        &self,
        checkpoint: (String, i32, i64),
        cancel: &CancellationToken,
    ) -> Result<()> {
        loop {
            let bootstrap = self.bootstrap_servers.clone();
            let group = self.group_id.clone();
            let (topic, partition, offset) = checkpoint.clone();
            let committed = tokio::select! { () = cancel.cancelled() => anyhow::bail!("wallet Kafka visibility wait cancelled"), value = tokio::task::spawn_blocking(move || committed_offset(&bootstrap, &group, &topic, partition)) => value.context("join wallet Kafka visibility query")?? };
    80|            if committed > offset {
                return Ok(());
            }
            tokio::select! { () = cancel.cancelled() => anyhow::bail!("wallet Kafka visibility wait cancelled"), () = tokio::time::sleep(Duration::from_secs(1)) => {} }
        }
    }
    pub fn flush(&self) -> Result<()> {
        use rdkafka::producer::Producer;
        self.producer
            .flush(Timeout::After(Duration::from_secs(30)))
    90|            .context("flush wallet Kafka producer")
    }
}
fn committed_offset(bootstrap: &str, group: &str, topic: &str, partition: i32) -> Result<i64> {
    let consumer: BaseConsumer = ClientConfig::new()
        .set("bootstrap.servers", bootstrap)
        .set("group.id", group)
        .set("enable.auto.commit", "false")
        .create()
        .context("create wallet Kafka visibility consumer")?;
   100|    let mut requested = TopicPartitionList::new();
    requested.add_partition(topic, partition);
    let committed = consumer
        .committed_offsets(requested, Timeout::After(Duration::from_secs(5)))
        .context("read clickhouse injector wallet commit offset")?;
    Ok(committed
        .find_partition(topic, partition)
        .and_then(|entry| entry.offset().to_raw())
        .unwrap_or(-1))
}
   110|
#[cfg(test)]
mod tests {
    use super::{WALLET_STATS_EVENTS_TOPIC, WalletKafkaWriter};
    #[test]
    fn wallet_kafka_contract_is_fixed() {
        assert_eq!(WALLET_STATS_EVENTS_TOPIC, "ch.wallet_stats_events.v1");
        WalletKafkaWriter::new("127.0.0.1:1", "superbot-clickhouse-injector", 1).unwrap();
    }
}
   120|
```
