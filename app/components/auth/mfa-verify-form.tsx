'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Spinner } from '@/components/ui/spinner'
import { useRouter } from '@/lib/i18n/navigation'

export function MfaVerifyForm() {
  const t = useTranslations('auth.mfa_verify')
  const router = useRouter()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (value: string) => {
    if (value.length !== 6) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ code: value }),
      })

      if (res.status === 401) {
        toast.error(t('errors.invalid'))
        setCode('')
        return
      }
      if (res.status === 429) {
        toast.error(t('errors.rate_limited'))
        return
      }
      if (!res.ok) {
        toast.error(t('errors.generic'))
        return
      }
      router.replace('/projects')
      router.refresh()
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(v) => {
            setCode(v)
            if (v.length === 6) submit(v)
          }}
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
        onClick={() => submit(code)}
      >
        {submitting ? <Spinner /> : null}
        {t('submit')}
      </Button>
    </div>
  )
}
