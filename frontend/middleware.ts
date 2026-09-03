import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, defaultLocale, isLocale } from './i18n/config';

// Auth is handled client-side (see components/RequireAuth.tsx). The only job
// of this middleware is to make sure the locale cookie exists and is valid.
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const current = request.cookies.get(LOCALE_COOKIE)?.value;
  if (!isLocale(current)) {
    response.cookies.set(LOCALE_COOKIE, defaultLocale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
