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
    category_id: 8,
  };

  const secondEventType: PersonEventType = {
    id: 13,
    user_id: 3,
    name: 'Lesen',
    color: '#40c057',
    category_id: 9,
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
            getPersonEventTypes: vi.fn(() => of([eventType, secondEventType])),
            getPlans: vi.fn(() => of([plan])),
          },
        },
        {
          provide: CalendarService,
          useValue: {
            reloadUsers: vi.fn(() => of([user])),
            categories$: of([
              { id: 8, label: 'Schule' },
              { id: 9, label: 'Freizeit' },
              { id: 10, label: 'Ohne Tasks' },
            ]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberDetailsComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders the plan grid and maps its choices and visibility back to the assignment', () => {
    const component = fixture.componentInstance;
    component.selectPlan(plan.id);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).not.toContain('Persönliche Fächer und Eventarten');
    expect(element.querySelector('lib-plan-learn')).not.toBeNull();
    expect(component.planLearnTimeSlots).toEqual([
      { id: '1', start: '08:00', end: '08:45', label: '1.' },
    ]);
    expect(component.planLearnCategories).toEqual([
      { id: '8', name: 'Schule' },
      { id: '9', name: 'Freizeit' },
      { id: '10', name: 'Ohne Tasks' },
    ]);
    expect(component.planLearnSubjects.map(({ id, categoryId }) => ({ id, categoryId }))).toEqual([
      { id: '12', categoryId: '8' },
      { id: '13', categoryId: '9' },
    ]);

    component.onPlanEntryChange({ dayId: 'Montag', timeSlotId: '1', subjectId: '12' });
    component.onPlanHideRequested({
      dayId: 'Montag',
      timeSlotId: '1',
      subjectId: '12',
      hidden: true,
    });

    expect(component.scheduleEntries[0]).toMatchObject({
      event_type_id: eventType.id,
      visible: false,
    });
    expect(component.planLearnEntries).toEqual([
      { dayId: 'Montag', timeSlotId: '1', subjectId: '12', hidden: true },
    ]);
  });
});
