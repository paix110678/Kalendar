import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarService, User } from '../../../services/calendar.service';
import { UserSelectorComponent } from './user-selector.component';

describe('UserSelectorComponent', () => {
  const user: User = {
    id: 3,
    name: 'Alex',
    role: 'child_10',
    current_points: 0,
    status_school: 'GREEN',
    status_sport: 'BASE',
    color_code: '#228be6',
    state_code: null,
    assigned_plan_id: null,
    is_active: true,
  };

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('toggles visibility on a touch long press without opening rewards', async () => {
    await TestBed.configureTestingModule({
      imports: [UserSelectorComponent],
      providers: [{ provide: CalendarService, useValue: {} }],
    }).compileComponents();

    const component = TestBed.createComponent(UserSelectorComponent).componentInstance;
    const visibilityToggled = vi.spyOn(component.userVisibilityToggled, 'emit');
    const rewardOpened = vi.spyOn(component.rewardDashboardOpened, 'emit');
    const pointerDown = createPointerEvent(0);
    const slightMove = createPointerEvent(12);
    vi.useFakeTimers();

    component.startLongPress(pointerDown, user.id);
    component.moveLongPress(slightMove);
    vi.advanceTimersByTime(600);
    component.openRewards(user);

    expect(visibilityToggled).toHaveBeenCalledWith({ userId: user.id, event: pointerDown });
    expect(rewardOpened).not.toHaveBeenCalled();
  });
});

function createPointerEvent(clientX: number): PointerEvent {
  const event = new Event('pointerdown');
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    pointerId: { value: 1 },
    clientX: { value: clientX },
    clientY: { value: 0 },
  });
  return event as PointerEvent;
}
