import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
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
    days: ['Montag', 'Mittwoch', 'Freitag'],
    hours_count: 2,
    hours: [
      { start_time: '08:00', end_time: '08:45' },
      { start_time: '08:50', end_time: '09:35' },
    ],
    uniform_time: false,
    uniform_count: false,
    day_hours: {
      Montag: [{ start_time: '08:00', end_time: '08:45' }],
      Mittwoch: [
        { start_time: '09:00', end_time: '09:45' },
        { start_time: '10:00', end_time: '10:45' },
      ],
      Freitag: [{ start_time: '08:30', end_time: '09:15' }],
    },
    exclude_school_holidays: false,
    exclude_public_holidays: false,
  };

  const user: User = {
    id: 3,
    name: 'Alex',
    role: 'child_10',
    current_points: 23,
    status_school: 'RED',
    status_sport: 'SILBER',
    color_code: '#228be6',
    state_code: null,
    assigned_plan_id: null,
    is_active: true,
  };
  const updateUserProfile = vi.fn((_userId: number, profile: Partial<User>) =>
    of({ user: { ...user, ...profile }, blocks_changed: false }),
  );
  const applyPlan = vi.fn(() => of({
    status: 'ok',
    created_blocks: 3,
    assigned_plan_id: plan.id,
    assignment_id: 12,
  }));
  const getUserPlanAssignment = vi.fn(() => of({
    id: 12,
    user_id: user.id,
    plan_id: plan.id,
    title: plan.name,
    events: [],
  }));

  beforeEach(async () => {
    updateUserProfile.mockClear();
    applyPlan.mockClear();
    getUserPlanAssignment.mockClear();
    await TestBed.configureTestingModule({
      imports: [MemberDetailsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getPersonEventTypes: vi.fn(() => of([eventType, secondEventType])),
            getPlans: vi.fn(() => of([plan])),
            getUserPlanAssignment,
          },
        },
        {
          provide: CalendarService,
          useValue: {
            reloadUsers: vi.fn(() => of([user])),
            updateUserProfile,
            applyPlan,
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

  it('renders only the plan selection without the removed plan grid', () => {
    const component = fixture.componentInstance;
    component.selectPlan(plan.id);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).not.toContain('Wähle für jede Stunde');
    expect(element.querySelector('lib-plan-learn')).toBeNull();
    expect(component.scheduleDays).toEqual(['Montag', 'Mittwoch', 'Freitag']);
    expect(component.scheduleEntries.map(({ day_of_week, period }) => ({ day_of_week, period }))).toEqual([
      { day_of_week: 'Montag', period: 1 },
      { day_of_week: 'Mittwoch', period: 1 },
      { day_of_week: 'Mittwoch', period: 2 },
      { day_of_week: 'Freitag', period: 1 },
    ]);
  });

  it('applies one selected task to every time slot for uniform activities', () => {
    const component = fixture.componentInstance;
    component.plans = [{ ...plan, uniform_activities: true, uniform_task_id: 42 }];
    component.selectPlan(plan.id);

    component.applyPlan();

    expect(applyPlan).toHaveBeenCalledWith(
      user.id,
      plan.id,
      plan.name,
      [],
      [],
    );
    expect(component.planError).toBe('');
  });

  it('keeps remaining conflicts open after saving and closes when the plan is applied', async () => {
    const component = fixture.componentInstance;
    component.plans = [{ ...plan, uniform_activities: true, uniform_task_id: 42 }];
    component.selectPlan(plan.id);
    component.conflicts = [
      {
        id: 21,
        title: 'Sport',
        day_of_week: 'Montag',
        start_time: '08:15',
        end_time: '09:00',
        type: 'sport',
        action: 'delete',
        newDay: 'Montag',
        newStart: '',
        newEnd: '',
      },
      {
        id: 22,
        title: 'Musik',
        day_of_week: 'Mittwoch',
        start_time: '09:00',
        end_time: '09:45',
        type: 'duty',
        action: 'delete',
        newDay: 'Mittwoch',
        newStart: '',
        newEnd: '',
      },
    ];
    component.conflictDialogOpen = true;
    applyPlan.mockImplementationOnce(() => throwError(() => new HttpErrorResponse({
      status: 409,
      error: {
        detail: {
          message: 'Ein Konflikt besteht weiterhin.',
          conflicts: [{
            id: 21,
            title: 'Sport',
            day_of_week: 'Montag',
            start_time: '08:15',
            end_time: '09:00',
            type: 'sport',
          }],
        },
      },
    })));
    applyPlan.mockImplementationOnce(() => of({
      status: 'ok',
      created_blocks: 3,
      assigned_plan_id: plan.id,
      assignment_id: 12,
    }));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const saveButton = element.querySelector<HTMLButtonElement>('.conflict-dialog-actions .footer-save');
    const cancelButton = element.querySelector<HTMLButtonElement>('.conflict-dialog-actions .footer-cancel');
    expect(saveButton?.getAttribute('aria-label')).toBe('Speichern');
    expect(cancelButton?.getAttribute('aria-label')).toBe('Abbrechen');
    expect(saveButton?.textContent?.trim()).toBe('');
    expect(cancelButton?.textContent?.trim()).toBe('');

    saveButton?.click();
    await vi.waitFor(() => expect(component.conflicts).toHaveLength(1));
    expect(component.conflictDialogOpen).toBe(true);

    saveButton?.click();
    await vi.waitFor(() => expect(component.conflictDialogOpen).toBe(false));
    expect(applyPlan).toHaveBeenCalledTimes(2);
  });

  it('closes the conflict dialog without applying the plan when cancelled', () => {
    const component = fixture.componentInstance;
    component.conflictDialogOpen = true;
    fixture.detectChanges();

    const cancelButton = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.conflict-dialog-actions .footer-cancel');
    cancelButton?.click();

    expect(component.conflictDialogOpen).toBe(false);
    expect(applyPlan).not.toHaveBeenCalled();
  });

  it('keeps managed fields out of member details and preserves stored values on profile updates', async () => {
    const settingsForm = (fixture.nativeElement as HTMLElement).querySelector('.settings-form');
    const component = fixture.componentInstance;

    expect(settingsForm?.textContent).not.toContain('Farbe');
    expect(settingsForm?.textContent).not.toContain('Aktiv');
    expect(settingsForm?.textContent).not.toContain('Schulstatus');
    expect(settingsForm?.textContent).not.toContain('Sportstatus');
    expect(settingsForm?.textContent).not.toContain('Sterne');
    expect(settingsForm?.querySelector('input[type="checkbox"]')).toBeNull();

    component.name = 'Alex Neu';
    await component.saveChanges();

    expect(updateUserProfile).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        current_points: user.current_points,
        status_school: user.status_school,
        status_sport: user.status_sport,
      }),
    );
  });
});
