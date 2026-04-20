#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Orquestra uma rodada do OpenCode sobre o código em /repo.
#
# - O código-fonte do projeto analisado deve estar montado em /repo.
# - Os resultados são escritos em /results.
# - Requer ANTHROPIC_API_KEY (ou OPENAI_API_KEY) no ambiente, dependendo do
#   provedor escolhido via ANALYZER_MODEL.
#
# Saída:
#   - stdout: JSON da Analysis (se conseguir extrair e validar)
#   - /results/run-<id>-opencode.json: métricas + resposta bruta
# -----------------------------------------------------------------------------

if [[ ! -d /repo ]]; then
  echo "[analyzer-opencode] ERR: monte o código-fonte em /repo" >&2
  exit 2
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "[analyzer-opencode] ERR: defina ANTHROPIC_API_KEY ou OPENAI_API_KEY" >&2
  exit 2
fi

mkdir -p "${RESULTS_DIR:-/results}"
RUN_ID="$(date +%s)-$RANDOM"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
T0=$(date +%s%3N 2>/dev/null || echo $(( $(date +%s) * 1000 )))

SYSTEM_PROMPT="$(cat /work/system-prompt.md)"
USER_MSG="Analise o projeto em /repo e retorne o JSON final descrito no system prompt."

# Prompt completo passado ao opencode. Concatenamos system + user porque
# `opencode run` não expõe um canal de system prompt separado de forma
# estável entre versões.
FULL_PROMPT=$'<<<SYSTEM>>>\n'"${SYSTEM_PROMPT}"$'\n<<<USER>>>\n'"${USER_MSG}"

RAW_OUTPUT_FILE="$(mktemp -t opencode-raw.XXXXXX)"
STDERR_FILE="$(mktemp -t opencode-err.XXXXXX)"

# Rodamos dentro do /repo pra que as tools internas do opencode operem ali.
set +e
(cd /repo && opencode run \
  --model "${ANALYZER_MODEL}" \
  "${FULL_PROMPT}" \
  > "${RAW_OUTPUT_FILE}" 2> "${STDERR_FILE}")
EXIT_CODE=$?
set -e

T1=$(date +%s%3N 2>/dev/null || echo $(( $(date +%s) * 1000 )))
DURATION_MS=$(( T1 - T0 ))
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[analyzer-opencode] exit=${EXIT_CODE} ms=${DURATION_MS} id=${RUN_ID}" >&2

# Parser valida o schema e grava métricas consolidadas.
cd /work/parser
node --experimental-strip-types parse.ts \
  --raw "${RAW_OUTPUT_FILE}" \
  --stderr "${STDERR_FILE}" \
  --run-id "${RUN_ID}" \
  --model "${ANALYZER_MODEL}" \
  --started-at "${STARTED_AT}" \
  --finished-at "${FINISHED_AT}" \
  --duration-ms "${DURATION_MS}" \
  --exit-code "${EXIT_CODE}" \
  --results-dir "${RESULTS_DIR:-/results}"
