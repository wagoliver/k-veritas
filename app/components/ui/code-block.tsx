'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

import { cn } from '@/lib/utils'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

/**
 * Bloco de código com syntax highlight via shiki. Fallback pra <pre> cru
 * enquanto o highlight carrega (shiki usa lazy-import da gramática/tema).
 * Re-highlight no toggle de tema (light/dark) via next-themes.
 */
export function CodeBlock({
  code,
  language = 'typescript',
  className,
}: CodeBlockProps) {
  const { resolvedTheme } = useTheme()
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Import dinâmico mantém shiki fora do bundle inicial da rota — só
    // entra em cena quando algum CodeBlock é montado.
    import('shiki')
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: language,
          theme: resolvedTheme === 'dark' ? 'github-dark' : 'github-light',
        }),
      )
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language, resolvedTheme])

  if (html === null) {
    return (
      <pre
        className={cn(
          'overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed',
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-md text-xs leading-relaxed [&_pre]:p-3 [&_pre]:font-mono',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
