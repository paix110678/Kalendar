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
    const pending = service.beginAction('Wird gespeichert');
    let cancelled = false;
    pending.cancelled$.subscribe(() => {
      cancelled = true;
    });
    expect(latestState?.cancelable).toBe(true);
    expect(latestState?.countdownSeconds).toBe(3);

    vi.advanceTimersByTime(1000);
    expect(latestState?.countdownSeconds).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(latestState?.countdownSeconds).toBe(1);

    service.confirmAction(pending.id);
    expect(latestState?.cancelable).toBe(false);
    expect(latestState?.countdownSeconds).toBeNull();
    service.cancelAction(pending.id);
    expect(cancelled).toBe(false);
    expect(latestState?.message).toBe('Wird gespeichert');

    service.finishAction(pending.id, true, 'Wurde gespeichert.', 1000);
    expect(latestState?.message).toBe('Wurde gespeichert.');
    vi.advanceTimersByTime(1000);
    expect(latestState).toBeNull();
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

  it('cancels a navigation warning without running its timeout action', () => {
    const onTimeout = vi.fn();
    const onCancel = vi.fn();
    const id = service.beginWarning('Ungespeicherte Änderungen', 5000, onTimeout, onCancel);

    expect(latestState?.warning).toBe(true);
    expect(latestState?.countdownSeconds).toBe(5);
    vi.advanceTimersByTime(1000);
    expect(latestState?.countdownSeconds).toBe(4);
    service.cancelAction(id);

    expect(latestState).toBeNull();
    expect(onCancel).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('runs the navigation action after a warning countdown expires', () => {
    const onTimeout = vi.fn();
    const id = service.beginWarning('Ungespeicherte Änderungen', 5000, onTimeout);

    vi.advanceTimersByTime(4999);
    expect(latestState?.id).toBe(id);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(latestState).toBeNull();
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('confirms a navigation warning immediately', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const id = service.beginWarning('Ungespeicherte Änderungen', 5000, onConfirm, onCancel);

    vi.advanceTimersByTime(1000);
    service.confirmWarning(id);

    expect(latestState).toBeNull();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('uses the checkmark to confirm pending actions and dismiss completed toasts', () => {
    const pending = service.beginAction('Wird gespeichert');
    let cancelled = false;
    pending.cancelled$.subscribe(() => {
      cancelled = true;
    });

    service.acknowledge(pending.id);

    expect(latestState?.pending).toBe(true);
    expect(latestState?.cancelable).toBe(false);
    expect(cancelled).toBe(false);

    service.finishAction(pending.id, true, 'Wurde gespeichert.', 1000);
    const completedId = latestState?.id;
    if (completedId === undefined || completedId === null) {
      throw new Error('Completed toast was not shown.');
    }

    service.acknowledge(completedId);
    expect(latestState).toBeNull();
  });
});
