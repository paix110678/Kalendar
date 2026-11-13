import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService, ToastState } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;
  let latestState: ToastState | null;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ToastService();
    latestState = null;
    service.state$.subscribe((state) => {
      latestState = state;
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows errors for five seconds and successes for three seconds', () => {
    service.show(false, 'Fehler');
    expect(latestState?.success).toBe(false);
    vi.advanceTimersByTime(4999);
    expect(latestState).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(latestState).toBeNull();

    service.show(true, 'Erledigt');
    expect(latestState?.success).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(latestState).toBeNull();
  });

  it('allows cancelling a pending action and locks it once confirmed', () => {
    const pending = service.beginAction('Änderung in 3 Sekunden …');
    let cancelled = false;
    pending.cancelled$.subscribe(() => {
      cancelled = true;
    });
    expect(latestState?.cancelable).toBe(true);

    service.confirmAction(pending.id);
    expect(latestState?.cancelable).toBe(false);
    service.cancelAction(pending.id);
    expect(cancelled).toBe(false);
    expect(latestState?.message).toBe('Wird gespeichert …');

    service.finishAction(pending.id, true, 'Gespeichert');
    expect(latestState?.message).toBe('Gespeichert');
  });

  it('cancels all currently pending actions from the shared toast', () => {
    const first = service.beginAction('Erste Änderung …');
    const second = service.beginAction('Zweite Änderung …');
    let firstCancelled = false;
    let secondCancelled = false;
    first.cancelled$.subscribe(() => {
      firstCancelled = true;
    });
    second.cancelled$.subscribe(() => {
      secondCancelled = true;
    });

    service.cancelAction(second.id);

    expect(firstCancelled).toBe(true);
    expect(secondCancelled).toBe(true);
    expect(latestState).toBeNull();
  });
});
