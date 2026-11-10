import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

function csrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('kalendar_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('kalendar_csrf='.length)) : null;
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const csrfToken = unsafeMethod ? csrfTokenFromCookie() : null;
  const headers = csrfToken
    ? request.headers.set('X-CSRF-Token', csrfToken)
    : request.headers;
  return next(request.clone({ withCredentials: true, headers })).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse
        && error.status === 401
        && !request.url.includes('/auth/me')
        && !request.url.includes('/auth/login')
        && typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new Event('kalendar:session-expired'));
      }
      return throwError(() => error);
    }),
  );
};
