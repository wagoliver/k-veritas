-- Histórico longo dos crawls. Postgres guarda apenas o crawl atual;
-- aqui fica o log temporal completo pra dashboards e diff histórico.
-- TTL 2 anos.

CREATE TABLE IF NOT EXISTS kveritas.crawl_runs (
    ts              DateTime DEFAULT now(),
    project_id      UUID,
    crawl_id        UUID,
    pages_count     UInt16,
    elements_count  UInt32,
    duration_ms     UInt32,
    status          LowCardinality(String),      -- completed | failed | cancelled
    trigger         LowCardinality(String),      -- manual | auto | scheduled
    requested_by    Nullable(UUID)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, ts)
TTL ts + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS kveritas.crawl_page_history (
    ts                   DateTime DEFAULT now(),
    project_id           UUID,
    crawl_id             UUID,
    page_path            String,
    title                String,
    status_code          UInt16,
    elements_count       UInt16,
    -- SHA-1 hex da lista ordenada de (kind|role|label).
    -- Igual entre crawls = página sem mudança estrutural.
    elements_fingerprint FixedString(40)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, page_path, ts)
TTL ts + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;
