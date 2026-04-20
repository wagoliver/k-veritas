-- Eventos do fluxo do codex pra cada job de análise de código. Espelha
-- o papel do crawl_pages no feed do crawler: registrar passo-a-passo
-- o que o agente fez, alimentando uma timeline visual.
--
-- Cada tool_use detectado no stream-json do Claude Code vira um evento
-- aqui (ex.: "Read: package.json"). Eventos de status (clone_start,
-- clone_done, claude_started, completed, failed) também.

CREATE TABLE IF NOT EXISTS code_analysis_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES code_analysis_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Categoria:
  --   'status'  → marco de fluxo (clone_start, claude_started, etc.)
  --   'tool'    → tool_use do Claude (Read, Grep, Bash, Write...)
  --   'text'    → chunk de texto do assistant (opcional, p/ debug)
  --   'error'   → mensagem de erro intermediária (rate limit, etc.)
  kind TEXT NOT NULL,
  -- Chave livre da categoria. Exemplos:
  --   kind='status', label='clone_start'
  --   kind='tool',   label='Read'
  --   kind='error',  label='rate_limit'
  label TEXT NOT NULL,
  -- Detalhe do evento (ex.: caminho do arquivo lido, pattern do grep,
  -- mensagem de erro truncada). Opcional.
  detail TEXT,
  CONSTRAINT code_analysis_events_kind_chk
    CHECK (kind IN ('status', 'tool', 'text', 'error'))
);

-- Feed é sempre lido por job + ordem cronológica.
CREATE INDEX IF NOT EXISTS code_analysis_events_job_idx
  ON code_analysis_events (job_id, created_at);
