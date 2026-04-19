'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Spinner } from '@/components/ui/spinner'
import { useRouter } from '@/lib/i18n/navigation'

interface EnrollPayload {
  secret: string
  otpauthUri: string
  qrSvg: string
}

export function MfaEnrollForm() {
  const t = useTranslations('auth.mfa_enroll')
  const router = useRouter()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: EnrollPayload }
    | { kind: 'error' }
  >({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/mfa/enroll', {
          method: 'GET',
          headers: { 'X-Requested-With': 'fetch' },
        })
        if (!res.ok) throw new Error('failed')
        const data = (await res.json()) as EnrollPayload
        if (!cancelled) setState({ kind: 'ready', data })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const confirm = async () => {
    if (state.kind !== 'ready' || code.length !== 6) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/mfa/enroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ secret: state.data.secret, code }),
      })
      if (res.status === 401) {
        toast.error(t('errors.invalid'))
        setCode('')
        return
      }
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }
      toast.success(t('success'))
      router.replace('/projects')
      router.refresh()
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('errors.generic')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-5">
      <div
        className="mx-auto flex size-48 items-center justify-center rounded-md bg-white p-2"
        dangerouslySetInnerHTML={{ __html: state.data.qrSvg }}
      />
      <div className="rounded-md border border-border bg-secondary/50 p-3 text-center font-mono text-sm tracking-widest">
        {state.data.secret}
      </div>
      <p className="text-sm text-muted-foreground">{t('instructions')}</p>

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={setCode}
          autoFocus
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        type="button"
        className="w-full"
        size="lg"
        disabled={submitting || code.length !== 6}
        onClick={confirm}
      >
        {submitting ? <Spinner /> : null}
        {t('submit')}
      </Button>
    </div>
  )
}
