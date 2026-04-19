-- Audit temporal de revisões de feature/scenario.
-- Cada toggle (marcar/desmarcar revisado) gera uma linha.
-- Snapshot do nome do usuário e do título do item pra sobreviver a deletes.
-- TTL 2 anos, alinhado com o resto do histórico.

CREATE TABLE IF NOT EXISTS kveritas.analysis_review_events (
    ts              DateTime DEFAULT now(),
    project_id      UUID,
    target_kind     LowCardinality(String),      -- 'feature' | 'scenario'
    target_id       UUID,
    action          LowCardinality(String),      -- 'marked' | 'unmarked'
    user_id         UUID,
    user_display    String,                      -- snapshot do display_name ou email
    title_snapshot  String                       -- título do item na hora do evento
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, ts)
TTL ts + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;
