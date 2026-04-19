-- ClickHouse: telemetria de eventos de autenticação
-- Aplicar via: node scripts/clickhouse-migrate.ts

CREATE DATABASE IF NOT EXISTS kveritas;

CREATE TABLE IF NOT EXISTS kveritas.auth_events (
    event_time DateTime64(3) DEFAULT now64(),
    event_type LowCardinality(String),
    user_id Nullable(UUID),
    email_hash FixedString(64),
    ip_inet String,
    user_agent String,
    outcome LowCardinality(String),
    meta String CODEC(ZSTD(3))
)
ENGINE = MergeTree
ORDER BY (event_time, event_type)
TTL toDateTime(event_time) + INTERVAL 180 DAY
SETTINGS index_granularity = 8192;
