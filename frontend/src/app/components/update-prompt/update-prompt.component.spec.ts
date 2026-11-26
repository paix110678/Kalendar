import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePromptComponent } from './update-prompt.component';

describe('UpdatePromptComponent', () => {
  const versionUpdates = new Subject<{ type: string }>();

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [UpdatePromptComponent],
      providers: [{
        provide: SwUpdate,
        useValue: { isEnabled: true, versionUpdates, checkForUpdate: vi.fn(() => Promise.resolve(false)) },
      }],
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  it('shows a countdown when a new version is ready and can be cancelled', () => {
    const fixture = TestBed.createComponent(UpdatePromptComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const restart = vi.spyOn(component, 'restart').mockImplementation(() => undefined);

    versionUpdates.next({ type: 'VERSION_READY' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Neue Version verfügbar');
    expect(component.secondsLeft()).toBe(5);

    vi.advanceTimersByTime(2000);
    expect(component.secondsLeft()).toBe(3);

    component.cancel();
    vi.advanceTimersByTime(10000);
    fixture.detectChanges();
    expect(component.visible()).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts when the countdown reaches zero', () => {
    const fixture = TestBed.createComponent(UpdatePromptComponent);
    fixture.detectChanges();
    const restart = vi.spyOn(fixture.componentInstance, 'restart').mockImplementation(() => undefined);

    versionUpdates.next({ type: 'VERSION_READY' });
    vi.advanceTimersByTime(5000);
    expect(restart).toHaveBeenCalled();
  });
});
