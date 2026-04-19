-- Previne corrida: 2 POSTs paralelos podiam passar pelo check "já tem
-- uma rodando?" e inserir 2 linhas `running` pro mesmo projeto.
-- O índice parcial único trava no DB: a segunda INSERT dispara
-- unique_violation e o caller devolve 409.

CREATE UNIQUE INDEX IF NOT EXISTS project_analyses_one_running_per_project
  ON project_analyses (project_id)
  WHERE status = 'running';
