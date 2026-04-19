import type { MailMessage, MailTransport } from './index'

export function consoleTransport(from: string): MailTransport {
  return {
    async send(message: MailMessage): Promise<void> {
      const separator = '─'.repeat(60)
      console.log(
        `\n${separator}\n[mail] ${from} → ${message.to}\n` +
          `[mail] subject: ${message.subject}\n` +
          `${separator}\n${message.text}\n${separator}\n`,
      )
    },
  }
}
