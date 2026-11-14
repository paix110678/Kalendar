import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_TOAST_OPTIONS, toastInterceptor } from './toast.interceptor';
import { ToastService, ToastState } from './toast.service';

describe('toastInterceptor', () => {
  let client: HttpClient;
  let httpTesting: HttpTestingController;
  let toastService: ToastService;
  let latestState: ToastState | null;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([toastInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    toastService = TestBed.inject(ToastService);
    latestState = null;
    toastService.state$.subscribe((state) => {
      latestState = state;
    });
  });

  afterEach(() => {
    httpTesting.verify();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows a save countdown and a brief green completion toast', () => {
    let response: unknown;
    client.post('/api/categories', {}).subscribe((value) => {
      response = value;
    });

    expect(latestState?.message).toBe('Wird gespeichert');
    expect(latestState?.success).toBe(true);
    expect(latestState?.countdownSeconds).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(latestState?.countdownSeconds).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(latestState?.countdownSeconds).toBe(1);
    vi.advanceTimersByTime(999);
    httpTesting.expectNone('/api/categories');
    expect(latestState?.cancelable).toBe(true);

    vi.advanceTimersByTime(1);
    httpTesting.expectOne('/api/categories').flush({ message: 'Kategorie gespeichert.' });
    expect(response).toEqual({ message: 'Kategorie gespeichert.' });
    expect(latestState?.success).toBe(true);
    expect(latestState?.message).toBe('Wurde gespeichert.');
    expect(latestState?.countdownSeconds).toBeNull();
    vi.advanceTimersByTime(999);
    expect(latestState).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(latestState).toBeNull();
  });

  it('does not send a mutation cancelled during the delay', () => {
    let requestError: unknown;
    client.post('/api/categories', {}).subscribe({
      error: (error: unknown) => {
        requestError = error;
      },
    });
    const actionId = latestState?.id;
    if (actionId === undefined || actionId === null) throw new Error('Pending action was not shown.');

    toastService.cancelAction(actionId);

    expect(httpTesting.expectNone('/api/categories')).toBeUndefined();
    expect(requestError).toMatchObject({ status: 499, error: { code: 'SAVE_CANCELLED' } });
    expect(latestState).toBeNull();
  });

  it('sends a mutation immediately when its toast is confirmed', () => {
    let response: unknown;
    client.post('/api/categories', {}).subscribe((value) => {
      response = value;
    });
    const actionId = latestState?.id;
    if (actionId === undefined || actionId === null) throw new Error('Pending action was not shown.');

    toastService.acknowledge(actionId);

    httpTesting.expectOne('/api/categories').flush({ message: 'Kategorie gespeichert.' });
    expect(response).toEqual({ message: 'Kategorie gespeichert.' });
    expect(latestState?.message).toBe('Wurde gespeichert.');
    vi.advanceTimersByTime(1000);
    expect(latestState).toBeNull();
  });

  it('shows request failures as red toasts', () => {
    client.post('/api/categories', {}).subscribe({ error: () => undefined });
    vi.advanceTimersByTime(3000);
    httpTesting.expectOne('/api/categories').flush(
      { detail: 'Name ist bereits vergeben.' },
      { status: 409, statusText: 'Conflict' },
    );

    expect(latestState?.success).toBe(false);
    expect(latestState?.message).toBe('Name ist bereits vergeben.');
  });

  it('shows deletes in red with a countdown and a brief completion message', () => {
    client.delete('/api/config/locations/1').subscribe();
    expect(latestState?.message).toBe('Wird gelöscht');
    expect(latestState?.success).toBe(false);
    expect(latestState?.countdownSeconds).toBe(3);
    vi.advanceTimersByTime(3000);
    httpTesting.expectOne('/api/config/locations/1').flush({
      status: 'success',
      message: 'Wetterstandort wurde gelöscht.',
    });

    expect(latestState?.success).toBe(false);
    expect(latestState?.message).toBe('Wurde gelöscht.');
    vi.advanceTimersByTime(1000);
    expect(latestState).toBeNull();
  });

  it('uses the cancel window and cancelability configured for a request', () => {
    client.post('/api/categories', {}, {
      context: new HttpContext().set(SAVE_TOAST_OPTIONS, {
        cancelWindowMs: 1000,
        cancelable: false,
      }),
    }).subscribe();

    expect(latestState?.cancelable).toBe(false);
    vi.advanceTimersByTime(999);
    httpTesting.expectNone('/api/categories');
    vi.advanceTimersByTime(1);
    httpTesting.expectOne('/api/categories').flush({});
  });
});
