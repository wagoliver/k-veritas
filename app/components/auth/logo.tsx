import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="k-veritas"
      className={cn('select-none', className)}
    >
      <defs>
        <linearGradient id="kv-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="oklch(0.78 0.16 182)" />
          <stop offset="100%" stopColor="oklch(0.68 0.14 245)" />
        </linearGradient>
      </defs>
      <g fill="url(#kv-grad)">
        <path d="M4 4 L10 4 L10 14 L18 4 L26 4 L16 16 L26 28 L18 28 L10 18 L10 28 L4 28 Z" />
      </g>
      <text
        x="32"
        y="22"
        fill="currentColor"
        fontFamily="var(--font-outfit, system-ui)"
        fontSize="18"
        fontWeight="700"
        letterSpacing="-0.02em"
      >
        veritas
      </text>
    </svg>
  )
}
