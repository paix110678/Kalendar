import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subscription, filter, interval } from 'rxjs';

export const UPDATE_COUNTDOWN_SECONDS = 5;
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-update-prompt',
  standalone: true,
  template: `
    @if (visible()) {
      <div class="update-backdrop">
        <div class="update-dialog" role="alertdialog" aria-modal="true" aria-labelledby="update-title">
          <h2 id="update-title">Neue Version verfügbar</h2>
          <p>Die App wird in {{ secondsLeft() }} {{ secondsLeft() === 1 ? 'Sekunde' : 'Sekunden' }} neu gestartet.</p>
          <div class="update-actions">
            <button type="button" class="update-cancel" (click)="cancel()">Abbrechen</button>
            <button type="button" class="update-now" (click)="restart()">Jetzt neu starten</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .update-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.4);
    }
    .update-dialog {
      width: min(90vw, 24rem);
      padding: 1.25rem;
      border-radius: 0.75rem;
      background: #fff;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
      font-family: inherit;
    }
    h2 { margin: 0 0 0.5rem; font-size: 1.2rem; }
    p { margin: 0 0 1rem; }
    .update-actions { display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; }
    button {
      padding: 0.5rem 1rem;
      border: 1px solid #adb5bd;
      border-radius: 0.5rem;
      background: #fff;
      font: inherit;
      cursor: pointer;
    }
    .update-now { background: #228be6; border-color: #228be6; color: #fff; }
  `,
})
export class UpdatePromptComponent implements OnInit, OnDestroy {
  private readonly swUpdate = inject(SwUpdate);
  private readonly subscriptions = new Subscription();
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly visible = signal(false);
  readonly secondsLeft = signal(UPDATE_COUNTDOWN_SECONDS);

  ngOnInit(): void {
    if (!this.swUpdate.isEnabled) return;
    this.subscriptions.add(
      this.swUpdate.versionUpdates
        .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
        .subscribe(() => this.startCountdown()),
    );
    this.subscriptions.add(interval(UPDATE_CHECK_INTERVAL_MS).subscribe(() => this.checkForUpdate()));
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.subscriptions.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  cancel(): void {
    this.stopTimer();
    this.visible.set(false);
  }

  restart(): void {
    this.stopTimer();
    document.location.reload();
  }

  private startCountdown(): void {
    if (this.visible()) return;
    this.secondsLeft.set(UPDATE_COUNTDOWN_SECONDS);
    this.visible.set(true);
    this.timer = setInterval(() => {
      const next = this.secondsLeft() - 1;
      this.secondsLeft.set(Math.max(next, 0));
      if (next <= 0) this.restart();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private checkForUpdate(): void {
    this.swUpdate.checkForUpdate().catch(() => undefined);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.checkForUpdate();
  };
}
