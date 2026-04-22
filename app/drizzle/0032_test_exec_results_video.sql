-- Vídeo completo do run Playwright, gravado ao lado do trace e screenshot.
-- Path absoluto seguindo o mesmo padrão dos outros artefatos:
--   /data/projects/<projectId>/exec/<runId>/scenario-<slug>/video.webm
--
-- Servido via GET /api/projects/<id>/test-exec/runs/<runId>/artifacts/<path>.

ALTER TABLE test_exec_results
  ADD COLUMN IF NOT EXISTS video_path TEXT;
