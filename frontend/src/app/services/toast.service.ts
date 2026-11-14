import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export interface ToastState {
  id: number;
  success: boolean;
  message: string;
  pending: boolean;
  cancelable: boolean;
  countdownSeconds: number | null;
  warning: boolean;
}

export interface PendingToast {
  id: number;
  cancelled$: Observable<void>;
  cancelWindowMs: number;
}

export interface ToastActionOptions {
  cancelable?: boolean;
  cancelWindowMs?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly stateSubject = new BehaviorSubject<ToastState | null>(null);
  readonly state$ = this.stateSubject.asObservable();
  private readonly pendingActions = new Map<number, Subject<void>>();
  private readonly pendingMessages = new Map<number, string>();
  private readonly pendingSuccess = new Map<number, boolean>();
  private readonly countdownDeadlines = new Map<number, number>();
  private readonly warningCallbacks = new Map<number, () => void>();
  private readonly warningCancelCallbacks = new Map<number, () => void>();
  private nextId = 0;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  show(success: boolean, message: string, durationMs = success ? 3000 : 5000): void {
    this.clearWarnings();
    const id = ++this.nextId;
    this.clearDismissTimer();
    this.stateSubject.next({
      id,
      success,
      message,
      pending: false,
      cancelable: false,
      countdownSeconds: null,
      warning: false,
    });
    this.dismissTimer = setTimeout(() => {
      if (this.stateSubject.value?.id === id) this.stateSubject.next(null);
      this.dismissTimer = null;
    }, durationMs);
  }

  beginAction(
    message: string,
    options: ToastActionOptions = {},
    success = true,
  ): PendingToast {
    this.clearWarnings();
    const id = ++this.nextId;
    const cancelled = new Subject<void>();
    const deadline = Date.now() + (options.cancelWindowMs ?? 3000);
    this.pendingActions.set(id, cancelled);
    this.pendingMessages.set(id, message);
    this.pendingSuccess.set(id, success);
    this.countdownDeadlines.set(id, deadline);
    this.clearDismissTimer();
    this.stateSubject.next({
      id,
      success,
      message,
      pending: true,
      cancelable: options.cancelable ?? true,
      countdownSeconds: Math.ceil((deadline - Date.now()) / 1000),
      warning: false,
    });
    this.startCountdownTimer();
    return {
      id,
      cancelled$: cancelled.asObservable(),
      cancelWindowMs: options.cancelWindowMs ?? 3000,
    };
  }

  cancelAction(id: number): void {
    const warningCallback = this.warningCallbacks.get(id);
    if (warningCallback) {
      this.warningCallbacks.delete(id);
      const onCancel = this.warningCancelCallbacks.get(id);
      this.warningCancelCallbacks.delete(id);
      this.countdownDeadlines.delete(id);
      if (this.stateSubject.value?.id === id) this.stateSubject.next(null);
      if (this.countdownDeadlines.size === 0) this.stopCountdownTimer();
      onCancel?.();
      return;
    }
    if (!this.pendingActions.has(id)) return;
    for (const [actionId, cancelled] of this.pendingActions) {
      this.pendingActions.delete(actionId);
      this.pendingMessages.delete(actionId);
      this.pendingSuccess.delete(actionId);
      this.countdownDeadlines.delete(actionId);
      cancelled.next();
      cancelled.complete();
    }
    this.stopCountdownTimer();
    if (this.stateSubject.value?.pending) this.stateSubject.next(null);
  }

  confirmWarning(id: number): void {
    const onConfirm = this.warningCallbacks.get(id);
    if (!onConfirm) return;
    this.warningCallbacks.delete(id);
    this.warningCancelCallbacks.delete(id);
    this.countdownDeadlines.delete(id);
    if (this.stateSubject.value?.id === id) this.stateSubject.next(null);
    if (this.countdownDeadlines.size === 0) this.stopCountdownTimer();
    onConfirm();
  }

  acknowledge(id: number): void {
    const current = this.stateSubject.value;
    if (current?.id !== id) return;
    if (current.warning) {
      this.confirmWarning(id);
      return;
    }
    if (current.pending) {
      if (current.cancelable) this.confirmAction(id);
      return;
    }
    this.clearDismissTimer();
    this.stateSubject.next(null);
  }

  beginWarning(
    message: string,
    durationMs: number,
    onTimeout: () => void,
    onCancel?: () => void,
  ): number {
    const id = ++this.nextId;
    const deadline = Date.now() + durationMs;
    this.warningCallbacks.set(id, onTimeout);
    if (onCancel) this.warningCancelCallbacks.set(id, onCancel);
    this.countdownDeadlines.set(id, deadline);
    this.clearDismissTimer();
    this.stateSubject.next({
      id,
      success: false,
      message,
      pending: false,
      cancelable: true,
      countdownSeconds: Math.ceil(durationMs / 1000),
      warning: true,
    });
    this.startCountdownTimer();
    return id;
  }

  finishAction(
    id: number,
    success: boolean,
    message: string,
    durationMs = success ? 3000 : 5000,
  ): void {
    const cancelled = this.pendingActions.get(id);
    if (cancelled) {
      this.pendingActions.delete(id);
      cancelled.complete();
    }
    this.pendingMessages.delete(id);
    this.pendingSuccess.delete(id);
    this.countdownDeadlines.delete(id);
    if (this.countdownDeadlines.size === 0) this.stopCountdownTimer();
    if (this.stateSubject.value?.id !== id) return;
    this.show(success, message, durationMs);
  }

  confirmAction(id: number): void {
    const cancelled = this.pendingActions.get(id);
    if (cancelled) {
      this.pendingActions.delete(id);
      cancelled.complete();
    }
    this.countdownDeadlines.delete(id);
    const current = this.stateSubject.value;
    if (current?.id === id && current.pending) {
      const pendingIds = Array.from(this.pendingActions.keys());
      const nextPendingId = pendingIds[pendingIds.length - 1];
      if (nextPendingId === undefined) {
        this.stateSubject.next({ ...current, cancelable: false, countdownSeconds: null });
      } else {
        const deadline = this.countdownDeadlines.get(nextPendingId);
        this.stateSubject.next({
          ...current,
          id: nextPendingId,
          success: this.pendingSuccess.get(nextPendingId) ?? true,
          message: this.pendingMessages.get(nextPendingId) ?? current.message,
          cancelable: true,
          countdownSeconds: deadline === undefined
            ? null
            : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
        });
      }
    }
    if (this.countdownDeadlines.size === 0) this.stopCountdownTimer();
  }

  private startCountdownTimer(): void {
    if (this.countdownTimer !== null) return;
    this.countdownTimer = setInterval(() => {
      const current = this.stateSubject.value;
      if (!current || (!current.pending && !current.warning) || !current.cancelable) return;
      const deadline = this.countdownDeadlines.get(current.id);
      if (deadline === undefined) return;
      const countdownSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (current.warning && countdownSeconds === 0) {
        this.confirmWarning(current.id);
        return;
      }
      if (current.countdownSeconds !== countdownSeconds) {
        this.stateSubject.next({ ...current, countdownSeconds });
      }
    }, 1000);
  }

  private stopCountdownTimer(): void {
    if (this.countdownTimer === null) return;
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private clearWarnings(): void {
    for (const [id, onCancel] of this.warningCancelCallbacks) {
      onCancel();
      this.countdownDeadlines.delete(id);
    }
    for (const id of this.warningCallbacks.keys()) {
      this.countdownDeadlines.delete(id);
    }
    this.warningCallbacks.clear();
    this.warningCancelCallbacks.clear();
    if (this.countdownDeadlines.size === 0) this.stopCountdownTimer();
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer !== null) clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
  }
}
