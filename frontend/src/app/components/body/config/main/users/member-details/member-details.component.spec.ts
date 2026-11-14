import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, PersonEventType, PlanDefinition } from '../../../../../../services/api.service';
import { CalendarService, User } from '../../../../../../services/calendar.service';
import { MemberDetailsComponent } from './member-details.component';

describe('MemberDetailsComponent', () => {
  let fixture: ComponentFixture<MemberDetailsComponent>;

  const eventType: PersonEventType = {
    id: 12,
    user_id: 3,
    name: 'Mathematik',
    color: '#228be6',
  };

  const plan: PlanDefinition = {
    id: 7,
    name: 'Schulplan',
    start_day: 'Montag',
    end_day: 'Montag',
    hours_count: 1,
    hours: [{ start_time: '08:00', end_time: '08:45' }],
    exclude_school_holidays: false,
    exclude_public_holidays: false,
  };

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberDetailsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getPersonEventTypes: vi.fn(() => of([eventType])),
            getPlans: vi.fn(() => of([plan])),
          },
        },
        {
          provide: CalendarService,
          useValue: {
            reloadUsers: vi.fn(() => of([user])),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberDetailsComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('keeps schedule choices while omitting the personal event type management section', () => {
    const component = fixture.componentInstance;
    component.selectPlan(plan.id);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const eventTypeSelect = element.querySelector('.event-type-cell select');

    expect(element.textContent).not.toContain('Persönliche Fächer und Eventarten');
    expect(eventTypeSelect?.textContent).toContain('Mathematik');
  });
});
