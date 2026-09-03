import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, TIME_ZONE, resolveLocale } from './config';

export default getRequestConfig(async () => {
  const locale = resolveLocale(cookies().get(LOCALE_COOKIE)?.value);
  const messages = (await import(`./messages/${locale}.json`)).default;
  return { locale, messages, timeZone: TIME_ZONE };
});
