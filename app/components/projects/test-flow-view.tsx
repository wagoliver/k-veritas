'use client'

import {
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

interface TestFlowViewProps {
  code: string
}

export function TestFlowView({ code }: TestFlowViewProps) {
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

  return (
    <div className="border-t border-primary/20 bg-muted/30 p-4">
      <div className="space-y-4">
        {parsed.phases.map((phase, idx) => (
          <PhaseBlock
            key={idx}
            phase={phase}
            isLast={idx === parsed.phases.length - 1}
          />
        ))}
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
}: {
  phase: ParsedPhase
  isLast: boolean
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
                <StepRow key={i} step={step} />
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

const STEP_ICON_COLORS: Record<StepKind, string> = {
  goto: 'text-sky-600 dark:text-sky-400',
  click: 'text-blue-600 dark:text-blue-400',
  fill: 'text-violet-600 dark:text-violet-400',
  select: 'text-violet-600 dark:text-violet-400',
  hover: 'text-blue-600 dark:text-blue-400',
  check: 'text-blue-600 dark:text-blue-400',
  press: 'text-violet-600 dark:text-violet-400',
  locator: 'text-muted-foreground',
  assertion: 'text-fin-gain',
  wait: 'text-amber-600 dark:text-amber-400',
  raw: 'text-muted-foreground',
}

function StepRow({ step }: { step: ParsedStep }) {
  const [open, setOpen] = useState(false)
  const Icon = STEP_ICONS[step.kind]
  const iconColor = STEP_ICON_COLORS[step.kind]

  return (
    <li className="rounded-md border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <Icon className={cn('size-3.5 shrink-0', iconColor)} />
        <span className="min-w-0 flex-1 truncate">{step.verb}</span>
      </button>
      {open ? (
        <pre className="overflow-auto border-t border-border/40 bg-muted/30 px-3 py-2 font-mono text-[10px] leading-relaxed">
          <code>{step.rawLine}</code>
        </pre>
      ) : null}
    </li>
  )
}
