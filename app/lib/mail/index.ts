import 'server-only'

import { consoleTransport } from './console'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>
}

function from(): string {
  return process.env.MAIL_FROM ?? 'no-reply@k-veritas.local'
}

export function getMailer(): MailTransport {
  const t = (process.env.MAIL_TRANSPORT ?? 'console').toLowerCase()
  switch (t) {
    case 'console':
      return consoleTransport(from())
    default:
      // Placeholder para SMTP/Resend em fase futura
      return consoleTransport(from())
  }
}
