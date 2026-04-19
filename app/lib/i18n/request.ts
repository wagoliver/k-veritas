import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'

import { DEFAULT_LOCALE } from './config'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : DEFAULT_LOCALE

  const messages = (await import(`../../messages/${locale}.json`)).default

  // Timezone não é definido aqui: datas são renderizadas client-side com
  // timezone do browser pelo componente <DateTime/>. Mantém server agnóstico.
  return {
    locale,
    messages,
  }
})
