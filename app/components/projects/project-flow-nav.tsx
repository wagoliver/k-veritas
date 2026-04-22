'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

// Sequência fixa das telas do projeto. A ordem aqui define o fluxo
// próximo/voltar. Alinhada com o sidebar-nav.tsx (PROJECT_SECTIONS).
const STEPS = [
  { key: 'map', slug: 'map', labelKey: 'map' as const },
  { key: 'analysis', slug: 'analysis', labelKey: 'analysis' as const },
  { key: 'test_scenarios', slug: 'test-scenarios', labelKey: 'test_scenarios' as const },
  { key: 'execution', slug: 'execution', labelKey: 'execution' as const },
]

type StepKey = (typeof STEPS)[number]['key']

interface Props {
  projectId: string
  current: StepKey
}

/**
 * Navegação lateral próximo/anterior entre as telas do fluxo do projeto
 * (Estrutura → Cenário → Scripts → Execução). Renderiza somente os
 * botões que fazem sentido na posição atual.
 */
export function ProjectFlowNav({ projectId, current }: Props) {
  const tNav = useTranslations('shell.nav.project')
  const idx = STEPS.findIndex((s) => s.key === current)
  if (idx < 0) return null

  const prev = idx > 0 ? STEPS[idx - 1] : null
  const next = idx < STEPS.length - 1 ? STEPS[idx + 1] : null

  return (
    <nav className="mt-6 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
      {prev ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${projectId}/${prev.slug}`}>
            <ArrowLeft className="size-3.5" />
            {tNav(prev.labelKey)}
          </Link>
        </Button>
      ) : (
        <div />
      )}

      {next ? (
        <Button asChild size="sm">
          <Link href={`/projects/${projectId}/${next.slug}`}>
            {tNav(next.labelKey)}
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      ) : (
        <div />
      )}
    </nav>
  )
}
