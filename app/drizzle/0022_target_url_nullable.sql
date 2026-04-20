-- target_url deixa de ser obrigatório. Antes de code-first existir, todo
-- projeto tinha uma URL (a que o crawler percorria). Agora projetos
-- `source_type='repo'` podem ser criados sem URL de execução — a QA
-- pode preencher depois em Settings antes de disparar a aba Execução.
--
-- Projetos `source_type='url'` continuam exigindo target_url pelo
-- validator Zod no POST /api/projects (não precisa de CHECK no banco).

ALTER TABLE projects ALTER COLUMN target_url DROP NOT NULL;
