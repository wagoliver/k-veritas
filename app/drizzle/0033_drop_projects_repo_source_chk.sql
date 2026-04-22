-- Remove o constraint que exige repo_url ou repo_zip_path em projetos
-- com source_type='repo'. Com o novo fluxo de upload no wizard, o
-- projeto é criado ANTES do arquivo ser subido, então existe uma
-- janela onde ambos são null e isso é válido.
--
-- Integridade de runtime é mantida no endpoint /ai/analyze, que
-- rejeita análises em projetos sem fonte configurada.

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_repo_source_chk;
