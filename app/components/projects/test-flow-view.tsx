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
  MousePointer2,
  Search,
  Sparkles,
  Type,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import {
  parseTestCode,
  type ParsedPhase,
  type ParsedStep,
  type PhaseKind,
  type StepKind,
} from '@/lib/ai/parse-playwright-test'

export type StepStatus = 'idle' | 'running' | 'passed' | 'failed'

interface TestFlowViewProps {
  code: string
  /** Índice GLOBAL (flat) do step onde o teste falhou. Destacado em
   *  vermelho com banner. Use null/undefined quando não houver falha. */
  failedStepIndex?: number | null
  /** Status por step (índice global, mesmo comprimento de flatten(phases)).
   *  Quando fornecido, cada step ganha bolinha colorida. */
  stepStatuses?: StepStatus[] | null
}

export function TestFlowView({
  code,
  failedStepIndex,
  stepStatuses,
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

  // Corta stepStatuses em fatias por phase mantendo os índices corretos
  let globalStepCursor = 0
  return (
    <div className="border-t border-primary/20 bg-muted/30 p-4">
      <div className="space-y-4">
        {parsed.phases.map((phase, idx) => {
          const phaseStart = globalStepCursor
          globalStepCursor += phase.steps.length
          return (
            <PhaseBlock
              key={idx}
              phase={phase}
              isLast={idx === parsed.phases.length - 1}
              failedStepIndex={
                failedOffset?.phase === idx ? failedOffset.step : null
              }
              stepStatuses={
                stepStatuses
                  ? stepStatuses.slice(phaseStart, phaseStart + phase.steps.length)
                  : null
              }
            />
          )
        })}
      </div>
    </div>
  )
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
}: {
  phase: ParsedPhase
  isLast: boolean
  failedStepIndex: number | null
  stepStatuses: StepStatus[] | null
}) {
  const colors = PHASE_COLORS[phase.kind]
  return (
    <div className="relative">
      {/* Linha vertical conectora (exceto na última phase) */}
      {!isLast ? (
        <div
          className={cn(
            'absolute left-[5px] top-3 h-full w-px',
            phase.kind === 'given' && 'bg-amber-500/30',
            phase.kind === 'when' && 'bg-blue-500/30',
            phase.kind === 'then' && 'bg-fin-gain/30',
            phase.kind === 'setup' && 'bg-border',
          )}
          aria-hidden
        />
      ) : null}

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-1 size-3 shrink-0 rounded-full ring-2 ring-background',
            colors.dot,
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'flex flex-wrap items-baseline gap-2 font-mono text-[10px] font-bold uppercase tracking-wider',
              colors.label,
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
}: {
  step: ParsedStep
  failed?: boolean
  status?: StepStatus | null
}) {
  const effectiveStatus: StepStatus =
    status ?? (failed ? 'failed' : 'idle')
  const [open, setOpen] = useState(effectiveStatus === 'failed')
  const Icon = STEP_ICONS[step.kind]
  const iconColor = STEP_ICON_COLORS[step.kind]

  const isFailed = effectiveStatus === 'failed'
  const isRunning = effectiveStatus === 'running'
  const isPassed = effectiveStatus === 'passed'

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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
          isFailed
            ? 'hover:bg-destructive/10'
            : isRunning
              ? 'hover:bg-blue-500/10'
              : 'hover:bg-accent/40',
        )}
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
      </button>
      {open ? (
        <pre
          className={cn(
            'overflow-auto border-t px-3 py-2 font-mono text-[10px] leading-relaxed',
            isFailed
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-border/40 bg-muted/30',
          )}
        >
          <code>{step.rawLine}</code>
        </pre>
      ) : null}
    </li>
  )
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
