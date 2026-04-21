'use client'

import {
  AlertTriangle,
  CheckSquare,
  ChevronRight,
  CircleCheck,
  Clock,
  Code,
  Globe,
  Keyboard,
  List,
  Loader2,
  MousePointer2,
  Pencil,
  Search,
  Sparkles,
  Type,
  X,
} from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import {
  parseTestCode,
  replaceCodeLine,
  type ParsedPhase,
  type ParsedStep,
  type PhaseKind,
  type StepKind,
} from '@/lib/ai/parse-playwright-test'

export type StepStatus = 'idle' | 'running' | 'passed' | 'failed'

export interface StepArtifact {
  durationMs: number | null
  errorMessage: string | null
}

interface TestFlowViewProps {
  code: string
  /** Índice GLOBAL (flat) do step onde o teste falhou. Destacado em
   *  vermelho com banner. Use null/undefined quando não houver falha. */
  failedStepIndex?: number | null
  /** Status por step (índice global, mesmo comprimento de flatten(phases)).
   *  Quando fornecido, cada step ganha bolinha colorida. */
  stepStatuses?: StepStatus[] | null
  /** Metadata vinda da execução real (duração, erro por step). Quando
   *  fornecido, cada step exibe o tempo e, se falhou, a mensagem do erro. */
  stepArtifacts?: (StepArtifact | null)[] | null
  /** Quando true, cada step ganha botão de edição inline. O callback
   *  recebe o code completo já recalculado com a linha substituída. */
  editable?: boolean
  onCodeChange?: (newCode: string) => Promise<void> | void
}

export function TestFlowView({
  code,
  failedStepIndex,
  stepStatuses,
  stepArtifacts,
  editable = false,
  onCodeChange,
}: TestFlowViewProps) {
  const t = useTranslations('projects.overview.analysis.editor.test')
  const parsed = parseTestCode(code)

  if (parsed.isUnrecognized) {
    return (
      <div className="border-t border-primary/20 bg-muted/40 p-4">
        <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
          {t('flow_not_detected')}
        </div>
        <pre className="max-h-80 overflow-auto font-mono text-[10px] leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  // Converte índice global em (phaseIndex, stepIndex)
  let failedOffset: { phase: number; step: number } | null = null
  if (typeof failedStepIndex === 'number' && failedStepIndex >= 0) {
    let counter = 0
    for (let pi = 0; pi < parsed.phases.length; pi++) {
      const phase = parsed.phases[pi]
      for (let si = 0; si < phase.steps.length; si++) {
        if (counter === failedStepIndex) {
          failedOffset = { phase: pi, step: si }
          pi = parsed.phases.length
          break
        }
        counter++
      }
    }
  }

  // Corta stepStatuses/stepArtifacts em fatias por phase mantendo os índices
  let globalStepCursor = 0
  return (
    <div className="border-t border-primary/20 bg-muted/30 p-4">
      <div className="space-y-4">
        {parsed.phases.map((phase, idx) => {
          const phaseStart = globalStepCursor
          globalStepCursor += phase.steps.length
          const statusSlice = stepStatuses
            ? stepStatuses.slice(phaseStart, phaseStart + phase.steps.length)
            : null
          const artifactSlice = stepArtifacts
            ? stepArtifacts.slice(phaseStart, phaseStart + phase.steps.length)
            : null
          return (
            <PhaseBlock
              key={idx}
              phase={phase}
              isLast={idx === parsed.phases.length - 1}
              failedStepIndex={
                failedOffset?.phase === idx ? failedOffset.step : null
              }
              stepStatuses={statusSlice}
              stepArtifacts={artifactSlice}
              phaseStatus={derivePhaseStatus(statusSlice)}
              editable={editable}
              fullCode={code}
              onCodeChange={onCodeChange}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Status agregado de uma fase a partir dos status dos seus steps.
 * Regras (ordem importa):
 *   - algum step falhado → 'failed'
 *   - algum step rodando → 'running'
 *   - todos passaram (não vazio) → 'passed'
 *   - caso contrário → 'idle'
 * Retorna null quando não há informação de execução (mantém cor semântica).
 */
function derivePhaseStatus(
  statuses: StepStatus[] | null,
): StepStatus | null {
  if (!statuses || statuses.length === 0) return null
  if (statuses.some((s) => s === 'failed')) return 'failed'
  if (statuses.some((s) => s === 'running')) return 'running'
  if (statuses.every((s) => s === 'passed')) return 'passed'
  return 'idle'
}

const PHASE_COLORS: Record<
  PhaseKind,
  { dot: string; label: string; ring: string }
> = {
  given: {
    dot: 'bg-amber-500',
    label: 'text-amber-700 dark:text-amber-400',
    ring: 'border-amber-500/40',
  },
  when: {
    dot: 'bg-blue-500',
    label: 'text-blue-700 dark:text-blue-400',
    ring: 'border-blue-500/40',
  },
  then: {
    dot: 'bg-fin-gain',
    label: 'text-fin-gain',
    ring: 'border-fin-gain/40',
  },
  setup: {
    dot: 'bg-muted-foreground',
    label: 'text-muted-foreground',
    ring: 'border-border',
  },
}

const PHASE_LABELS: Record<PhaseKind, string> = {
  given: 'GIVEN',
  when: 'WHEN',
  then: 'THEN',
  setup: 'SETUP',
}

function PhaseBlock({
  phase,
  isLast,
  failedStepIndex,
  stepStatuses,
  stepArtifacts,
  phaseStatus,
  editable,
  fullCode,
  onCodeChange,
}: {
  phase: ParsedPhase
  isLast: boolean
  failedStepIndex: number | null
  stepStatuses: StepStatus[] | null
  stepArtifacts: (StepArtifact | null)[] | null
  phaseStatus: StepStatus | null
  editable: boolean
  fullCode: string
  onCodeChange?: (newCode: string) => Promise<void> | void
}) {
  const colors = PHASE_COLORS[phase.kind]

  // Cor do dot/conector:
  //   - Com phaseStatus (execução): cinza/verde/vermelho/azul derivados.
  //   - Sem phaseStatus (ex: aba Cenários de Teste): mantém paleta
  //     semântica (Given=amber, When=blue, Then=green) pra identificar
  //     a fase visualmente.
  const statusDotClass =
    phaseStatus === 'failed'
      ? 'bg-destructive'
      : phaseStatus === 'running'
        ? 'bg-blue-500 animate-pulse'
        : phaseStatus === 'passed'
          ? 'bg-fin-gain'
          : phaseStatus === 'idle'
            ? 'bg-muted-foreground/40'
            : null
  const statusLineClass =
    phaseStatus === 'failed'
      ? 'bg-destructive/30'
      : phaseStatus === 'running'
        ? 'bg-blue-500/30'
        : phaseStatus === 'passed'
          ? 'bg-fin-gain/30'
          : phaseStatus === 'idle'
            ? 'bg-muted-foreground/20'
            : null
  const statusLabelClass =
    phaseStatus === 'failed'
      ? 'text-destructive'
      : phaseStatus === 'running'
        ? 'text-blue-700 dark:text-blue-400'
        : phaseStatus === 'passed'
          ? 'text-fin-gain'
          : phaseStatus === 'idle'
            ? 'text-muted-foreground'
            : null

  const dotClass = statusDotClass ?? colors.dot
  const labelClass = statusLabelClass ?? colors.label
  return (
    <div className="relative">
      {/* Linha vertical conectora (exceto na última phase) */}
      {!isLast ? (
        <div
          className={cn(
            'absolute left-[5px] top-3 h-full w-px',
            statusLineClass ??
              (phase.kind === 'given'
                ? 'bg-amber-500/30'
                : phase.kind === 'when'
                  ? 'bg-blue-500/30'
                  : phase.kind === 'then'
                    ? 'bg-fin-gain/30'
                    : 'bg-border'),
          )}
          aria-hidden
        />
      ) : null}

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-1 size-3 shrink-0 rounded-full ring-2 ring-background',
            dotClass,
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'flex flex-wrap items-baseline gap-2 font-mono text-[10px] font-bold uppercase tracking-wider',
              labelClass,
            )}
          >
            <span>{PHASE_LABELS[phase.kind]}</span>
            {phase.description ? (
              <span className="font-sans text-xs font-medium normal-case tracking-normal text-foreground">
                {phase.description}
              </span>
            ) : null}
          </div>

          {phase.steps.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {phase.steps.map((step, i) => (
                <StepRow
                  key={i}
                  step={step}
                  failed={failedStepIndex === i}
                  status={stepStatuses?.[i] ?? null}
                  artifact={stepArtifacts?.[i] ?? null}
                  editable={editable}
                  fullCode={fullCode}
                  onCodeChange={onCodeChange}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const STEP_ICONS: Record<StepKind, typeof MousePointer2> = {
  goto: Globe,
  click: MousePointer2,
  fill: Keyboard,
  select: List,
  hover: Sparkles,
  check: CheckSquare,
  press: Type,
  locator: Search,
  assertion: CircleCheck,
  wait: Clock,
  raw: Code,
}

// Paleta neutra: todos os ícones em foreground neutro. A fase colorida
// (Given/When/Then) já carrega o significado semântico; os steps
// internos ficam limpos pra não competir visualmente.
const STEP_ICON_COLORS: Record<StepKind, string> = {
  goto: 'text-muted-foreground',
  click: 'text-muted-foreground',
  fill: 'text-muted-foreground',
  select: 'text-muted-foreground',
  hover: 'text-muted-foreground',
  check: 'text-muted-foreground',
  press: 'text-muted-foreground',
  locator: 'text-muted-foreground',
  assertion: 'text-muted-foreground',
  wait: 'text-muted-foreground',
  raw: 'text-muted-foreground',
}

function StepRow({
  step,
  failed = false,
  status = null,
  artifact = null,
  editable = false,
  fullCode,
  onCodeChange,
}: {
  step: ParsedStep
  failed?: boolean
  status?: StepStatus | null
  artifact?: StepArtifact | null
  editable?: boolean
  fullCode: string
  onCodeChange?: (newCode: string) => Promise<void> | void
}) {
  const t = useTranslations('projects.overview.analysis.editor.test')
  const effectiveStatus: StepStatus =
    status ?? (failed ? 'failed' : 'idle')
  const [open, setOpen] = useState(effectiveStatus === 'failed')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(step.rawLine.replace(/^\s*/, ''))
  const [saving, setSaving] = useState(false)
  const Icon = STEP_ICONS[step.kind]
  const iconColor = STEP_ICON_COLORS[step.kind]

  const isFailed = effectiveStatus === 'failed'
  const isRunning = effectiveStatus === 'running'
  const isPassed = effectiveStatus === 'passed'
  const canEdit = editable && !!onCodeChange && !isRunning

  const openEditor = (e: MouseEvent) => {
    e.stopPropagation()
    setDraft(step.rawLine.replace(/^\s*/, ''))
    setEditing(true)
    setOpen(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(step.rawLine.replace(/^\s*/, ''))
  }

  const saveEdit = async () => {
    if (!onCodeChange) return
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    if (trimmed === step.rawLine.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const nextCode = replaceCodeLine(fullCode, step.lineIndex, draft)
      await onCodeChange(nextCode)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li
      className={cn(
        'rounded-md border bg-card',
        isFailed
          ? 'border-destructive/60 bg-destructive/[0.06] ring-1 ring-destructive/40'
          : isRunning
            ? 'border-blue-500/60 bg-blue-500/[0.04] ring-1 ring-blue-500/40'
            : 'border-border/60',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 text-xs transition-colors',
          isFailed
            ? 'hover:bg-destructive/10'
            : isRunning
              ? 'hover:bg-blue-500/10'
              : 'hover:bg-accent/40',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <StatusDot status={effectiveStatus} />
          {isFailed ? (
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <Icon
              className={cn(
                'size-3.5 shrink-0',
                isPassed
                  ? 'text-fin-gain'
                  : isRunning
                    ? 'text-blue-600 dark:text-blue-400'
                    : iconColor,
              )}
            />
          )}
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              isFailed && 'font-medium text-destructive',
              isRunning && 'font-medium text-blue-700 dark:text-blue-300',
            )}
          >
            {step.verb}
          </span>
          {artifact && typeof artifact.durationMs === 'number' ? (
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
              {formatDuration(artifact.durationMs)}
            </span>
          ) : null}
        </button>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={openEditor}
            title={t('edit_step')}
            aria-label={t('edit_step')}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
        ) : null}
      </div>
      {open ? (
        editing ? (
          <div
            className={cn(
              'border-t px-2 py-2',
              isFailed ? 'border-destructive/30 bg-destructive/5' : 'border-border/40 bg-muted/30',
            )}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.max(2, draft.split('\n').length)}
              autoFocus
              disabled={saving}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] leading-relaxed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
            />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <X className="size-3" />
                {t('edit_cancel')}
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving || draft.trim().length === 0}
                className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CircleCheck className="size-3" />
                )}
                {t('edit_save')}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'border-t',
              isFailed
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-border/40 bg-muted/30',
            )}
          >
            {artifact?.errorMessage ? (
              <div className="border-b border-destructive/20 px-3 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                  {t('step_error_label')}
                </p>
                <p className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-destructive">
                  {artifact.errorMessage}
                </p>
              </div>
            ) : null}
            <pre className="overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed">
              <code>{step.rawLine}</code>
            </pre>
          </div>
        )
      ) : null}
    </li>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StatusDot({ status }: { status: StepStatus }) {
  const cls = {
    idle: 'bg-muted-foreground/40',
    running: 'bg-blue-500 animate-pulse',
    passed: 'bg-fin-gain',
    failed: 'bg-destructive',
  }[status]
  return (
    <span
      className={cn('size-2 shrink-0 rounded-full ring-2 ring-card', cls)}
      aria-hidden
    />
  )
}
