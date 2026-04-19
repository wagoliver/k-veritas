'use client'

import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useRouter } from '@/lib/i18n/navigation'

export function MfaCard() {
  const t = useTranslations('settings.security.mfa')
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'enabled' | 'disabled'>(
    'loading',
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [pending, start] = useTransition()

  const load = () => {
    start(async () => {
      const res = await fetch('/api/auth/mfa', {
        headers: { 'X-Requested-With': 'fetch' },
      })
      if (!res.ok) {
        toast.error(t('errors.load'))
        return
      }
      const data = (await res.json()) as { enabled: boolean }
      setState(data.enabled ? 'enabled' : 'disabled')
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const disable = () => {
    start(async () => {
      const res = await fetch('/api/auth/mfa', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ password }),
      })
      if (res.status === 401) {
        toast.error(t('errors.wrong_password'))
        return
      }
      if (!res.ok) {
        toast.error(t('errors.disable'))
        return
      }
      toast.success(t('disabled_toast'))
      setConfirmOpen(false)
      setPassword('')
      setState('disabled')
    })
  }

  const goEnroll = () => {
    router.push('/mfa/enroll')
  }

  const Icon = state === 'enabled' ? ShieldCheck : ShieldAlert

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            state === 'enabled'
              ? 'bg-fin-gain/15 text-fin-gain'
              : 'bg-amber-500/15 text-amber-500'
          }`}
        >
          <Icon className="size-5" />
        </div>

        <div className="flex-1">
          <h3 className="font-display text-base font-semibold">{t('title')}</h3>
          {state === 'loading' ? (
            <Skeleton className="mt-2 h-4 w-2/3" />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {state === 'enabled' ? t('enabled_desc') : t('disabled_desc')}
            </p>
          )}
        </div>

        <div>
          {state === 'loading' ? (
            <Skeleton className="h-9 w-24" />
          ) : state === 'enabled' ? (
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={pending}
            >
              {t('disable')}
            </Button>
          ) : (
            <Button onClick={goEnroll} disabled={pending}>
              {t('enable')}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v)
          if (!v) setPassword('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('disable_confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('disable_confirm_description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="mfa-disable-password"
              className="text-sm font-medium"
            >
              {t('password_label')}
            </label>
            <Input
              id="mfa-disable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password.length > 0) disable()
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={disable}
              disabled={pending || password.length === 0}
            >
              {pending ? <Spinner /> : null}
              {t('confirm_disable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
