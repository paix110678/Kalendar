import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export interface ToastState {
  id: number;
  success: boolean;
  message: string;
  pending: boolean;
  cancelable: boolean;
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
  private nextId = 0;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  show(success: boolean, message: string, durationMs = success ? 3000 : 5000): void {
    const id = ++this.nextId;
    this.clearDismissTimer();
    this.stateSubject.next({ id, success, message, pending: false, cancelable: false });
    this.dismissTimer = setTimeout(() => {
      if (this.stateSubject.value?.id === id) this.stateSubject.next(null);
      this.dismissTimer = null;
    }, durationMs);
  }

  beginAction(message: string, options: ToastActionOptions = {}): PendingToast {
    const id = ++this.nextId;
    const cancelled = new Subject<void>();
    this.pendingActions.set(id, cancelled);
    this.clearDismissTimer();
    this.stateSubject.next({
      id,
      success: true,
      message: this.pendingActions.size > 1
        ? `${this.pendingActions.size} Änderungen in ${Math.ceil((options.cancelWindowMs ?? 3000) / 1000)} Sekunden …`
        : message,
      pending: true,
      cancelable: options.cancelable ?? true,
    });
    return {
      id,
      cancelled$: cancelled.asObservable(),
      cancelWindowMs: options.cancelWindowMs ?? 3000,
    };
  }

  cancelAction(id: number): void {
    if (!this.pendingActions.has(id)) return;
    for (const [actionId, cancelled] of this.pendingActions) {
      this.pendingActions.delete(actionId);
      cancelled.next();
      cancelled.complete();
    }
    if (this.stateSubject.value?.pending) this.stateSubject.next(null);
  }

  finishAction(id: number, success: boolean, message: string): void {
    const cancelled = this.pendingActions.get(id);
    if (cancelled) {
      this.pendingActions.delete(id);
      cancelled.complete();
    }
    if (this.stateSubject.value?.id !== id) return;
    this.show(success, message, success ? 3000 : 5000);
  }

  confirmAction(id: number): void {
    const cancelled = this.pendingActions.get(id);
    if (cancelled) {
      this.pendingActions.delete(id);
      cancelled.complete();
    }
    const current = this.stateSubject.value;
    if (current?.id === id && current.pending) {
      const pendingIds = Array.from(this.pendingActions.keys());
      const nextPendingId = pendingIds[pendingIds.length - 1];
      this.stateSubject.next(nextPendingId === undefined
        ? { ...current, message: 'Wird gespeichert …', cancelable: false }
        : {
            ...current,
            id: nextPendingId,
            message: `${this.pendingActions.size} Änderungen in Kürze …`,
            cancelable: true,
          });
    }
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer !== null) clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
  }
}
