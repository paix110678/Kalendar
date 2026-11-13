import { HttpContextToken, HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, race, throwError, timer } from 'rxjs';
import { catchError, map, switchMap, take, tap } from 'rxjs/operators';
import { ToastActionOptions, ToastService } from './toast.service';

export const SAVE_TOAST_OPTIONS = new HttpContextToken<ToastActionOptions>(() => ({}));

export function toastInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const toastService = inject(ToastService);
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
  const url = new URL(request.url, window.location.origin);
  if (!isMutation || /\/auth\/(login|logout)$/.test(url.pathname)) return next(request);

  const options = request.context.get(SAVE_TOAST_OPTIONS);
  const pending = toastService.beginAction(
    `${actionName(url.pathname)} in ${Math.ceil((options.cancelWindowMs ?? 3000) / 1000)} Sekunden …`,
    options,
  );
  const cancelledError = new HttpErrorResponse({
    status: 499,
    statusText: 'Aktion abgebrochen',
    error: { code: 'SAVE_CANCELLED' },
  });

  return race(
    timer(pending.cancelWindowMs).pipe(map(() => true)),
    pending.cancelled$.pipe(map(() => false)),
  ).pipe(
    take(1),
    tap((confirmed) => {
      if (confirmed) toastService.confirmAction(pending.id);
    }),
    switchMap((confirmed) => confirmed ? next(request) : throwError(() => cancelledError)),
    tap((event) => {
      if (!(event instanceof HttpResponse)) return;
      const body = event.body as { message?: unknown } | null;
      const successMessage = typeof body?.message === 'string'
        ? body.message
        : `${actionName(url.pathname)} abgeschlossen.`;
      toastService.finishAction(pending.id, true, successMessage);
    }),
    catchError((error: unknown) => {
      if (error === cancelledError) return throwError(() => error);
      toastService.finishAction(pending.id, false, errorMessage(error));
      return throwError(() => error);
    }),
  );
}

function actionName(path: string): string {
  if (path.includes('/auth/')) return 'Kontoaktion';
  if (path.includes('/error-reports')) return 'Fehlerbericht';
  if (path.includes('/users/') || path.endsWith('/users')) return 'Familienmitgliedänderung';
  if (path.includes('/blocks')) return 'Kalenderänderung';
  if (path.includes('/plans')) return 'Stundenplanänderung';
  if (path.includes('/tasks')) return 'Aufgabenänderung';
  if (path.includes('/categories')) return 'Fachänderung';
  if (path.includes('/holidays')) return 'Ferienänderung';
  if (path.includes('/backups')) return 'Backupaktion';
  if (path.includes('/config')) return 'Einstellungsänderung';
  return 'Änderung';
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const detail = (error.error as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Die Aktion konnte nicht abgeschlossen werden.';
}
