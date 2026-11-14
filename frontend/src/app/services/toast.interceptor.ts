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
  const isDelete = request.method === 'DELETE';
  const pending = toastService.beginAction(
    isDelete ? 'Wird gelöscht' : 'Wird gespeichert',
    options,
    !isDelete,
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
      toastService.finishAction(
        pending.id,
        !isDelete,
        isDelete ? 'Wurde gelöscht.' : 'Wurde gespeichert.',
        1000,
      );
    }),
    catchError((error: unknown) => {
      if (error === cancelledError) return throwError(() => error);
      toastService.finishAction(pending.id, false, errorMessage(error));
      return throwError(() => error);
    }),
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const detail = (error.error as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Die Aktion konnte nicht abgeschlossen werden.';
}
