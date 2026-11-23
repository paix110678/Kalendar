import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, PlanDefinition } from '../../../../../services/api.service';
import { CalendarService } from '../../../../../services/calendar.service';
import { ToastService } from '../../../../../services/toast.service';
import { PlansComponent } from './plans.component';
import { PlanDetailsComponent } from './plan-details.component';

describe('PlansComponent', () => {
  let fixture: ComponentFixture<PlansComponent>;
  const savedPlan: PlanDefinition = {
    id: 5,
    name: 'Wechseltage',
    days: ['Montag', 'Mittwoch', 'Samstag'],
    hours_count: 1,
    hours: [{ start_time: '08:00', end_time: '08:45' }],
    uniform_time: true,
    uniform_count: true,
    day_hours: {},
    exclude_school_holidays: false,
    exclude_public_holidays: false,
  };
  const createPlan = vi.fn((plan: Omit<PlanDefinition, 'id'>) =>
    of({ id: savedPlan.id, ...plan }),
  );
  const updatePlan = vi.fn((_id: number, plan: Omit<PlanDefinition, 'id'>) =>
    of({ id: savedPlan.id, ...plan }),
  );
  const getPlans = vi.fn(() => of([savedPlan]));
  const refreshAllBlocks = vi.fn(() => of([]));
  const toastShow = vi.fn();

  beforeEach(async () => {
    createPlan.mockClear();
    updatePlan.mockClear();
    getPlans.mockClear();
    refreshAllBlocks.mockClear();
    toastShow.mockClear();
    await TestBed.configureTestingModule({
      imports: [PlansComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            createPlan,
            updatePlan,
            getPlans,
          },
        },
        { provide: CalendarService, useValue: { refreshAllBlocks } },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlansComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows seven abbreviated weekday checkboxes and saves the selected days', () => {
    const component = fixture.componentInstance;
    component.setupStep = false;
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const weekdayLabels = Array.from(element.querySelectorAll('.weekday-choice span'))
      .map((label) => label.textContent?.trim());

    expect(weekdayLabels).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(element.querySelectorAll('.weekday-choice input')).toHaveLength(7);
    expect(component.uniformTime).toBe(true);
    expect(component.uniformCount).toBe(true);
    expect(component.uniformActivities).toBe(true);
    expect(element.querySelector('select[name="startDay"]')).toBeNull();
    expect(element.querySelector('select[name="endDay"]')).toBeNull();

    const tuesday = element.querySelector('input[name="weekday-Dienstag"]') as HTMLInputElement;
    const saturday = element.querySelector('input[name="weekday-Samstag"]') as HTMLInputElement;
    tuesday.click();
    saturday.click();
    component.planName = 'Wechseltage';
    fixture.detectChanges();
    component.savePlan();

    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ days: ['Montag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] }),
    );
  });

  it('requires at least one selected weekday', () => {
    const component = fixture.componentInstance;
    component.setupStep = false;
    fixture.detectChanges();
    component.planName = 'Ohne Wochentag';
    component.selectedDays = [];

    component.savePlan();

    expect(createPlan).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      false,
      'Plan konnte nicht gespeichert werden: Bitte mindestens einen Wochentag auswählen.',
    );
  });

  it('saves incomplete task selections as empty slots and resizes them to the new hours', () => {
    const component = fixture.componentInstance;
    component.editPlan(savedPlan);
    component.uniformActivities = false;
    component.selectedDays = ['Montag'];
    component.hoursCount = 2;
    component.hours = [
      { start_time: '08:00', end_time: '08:45' },
      { start_time: '08:50', end_time: '09:35' },
    ];
    component.dayHours = {};
    component.activitySubjects = { Montag: [11, 0, 13] };

    component.savePlan();

    expect(updatePlan).toHaveBeenCalledWith(
      savedPlan.id,
      expect.objectContaining({ activity_subjects: { Montag: [11, 0] } }),
    );
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('saves all selected tasks when the plan has more time slots than before', () => {
    const component = fixture.componentInstance;
    component.editPlan(savedPlan);
    component.uniformActivities = false;
    component.selectedDays = ['Montag'];
    component.hoursCount = 2;
    component.hours = [
      { start_time: '08:00', end_time: '08:45' },
      { start_time: '08:50', end_time: '09:35' },
    ];
    component.dayHours = {};
    component.activitySubjects = { Montag: [11, 12, 13] };

    component.savePlan();

    expect(updatePlan).toHaveBeenCalledWith(
      savedPlan.id,
      expect.objectContaining({ activity_subjects: { Montag: [11, 12] } }),
    );
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('allows saving a uniform plan without a selected task', () => {
    const component = fixture.componentInstance;
    component.setupStep = false;
    component.planName = 'Plan ohne Task';
    component.tasks = [
      { id: 11, title: 'Lesen', color: '#228be6', category_id: 8, category_label: 'Schule', member_ids: [] },
    ];
    component.uniformActivities = true;
    component.uniformTaskId = null;

    component.savePlan();

    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ uniform_task_id: null }),
    );
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('keeps form changes when saving fails and the plan list refreshes', () => {
    const component = fixture.componentInstance;
    const draftName = 'Entwurf nach Erweiterung';
    component.plansChanged.subscribe((plans) => {
      fixture.componentRef.setInput('initialPlans', plans);
      fixture.detectChanges();
    });
    component.editPlan(savedPlan);
    component.planName = draftName;
    component.selectedDays = ['Montag'];
    updatePlan.mockImplementationOnce(() => throwError(() => new HttpErrorResponse({
      status: 422,
      error: { detail: 'Ungültige Planzeiten.' },
    })));

    component.savePlan();

    expect(component.planName).toBe(draftName);
    expect(component.errorMessage).toBe('Ungültige Planzeiten.');
    expect(component.validationIssues).toEqual([
      { target: 'hours', message: 'Ungültige Planzeiten.' },
    ]);
    expect(toastShow).toHaveBeenCalledWith(
      false,
      'Plan konnte nicht gespeichert werden: Ungültige Planzeiten.',
    );
    expect(component.saving).toBe(false);
  });

  it('marks a rejected server time field and shows its cause in the error toast', () => {
    const component = fixture.componentInstance;
    component.editPlan(savedPlan);
    updatePlan.mockImplementationOnce(() => throwError(() => new HttpErrorResponse({
      status: 422,
      error: {
        detail: [{
          loc: ['body', 'hours', 0, 'end_time'],
          msg: 'Value error, Das Ende einer Stunde muss nach ihrem Beginn.',
        }],
      },
    })));

    component.savePlan();
    fixture.detectChanges();

    expect(component.validationIssues).toEqual([{
      target: 'hour',
      hourIndex: 0,
      field: 'end_time',
      message: '1. Stunde, Ende: Das Ende einer Stunde muss nach ihrem Beginn.',
    }]);
    expect(toastShow).toHaveBeenCalledWith(
      false,
      'Plan konnte nicht gespeichert werden: 1. Stunde, Ende: Das Ende einer Stunde muss nach ihrem Beginn.',
    );
    expect(fixture.nativeElement.querySelector('.hour-row.plan-invalid')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.hour-row.plan-invalid input.plan-input-invalid')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.hour-error-message')?.textContent)
      .toContain('Das Ende einer Stunde muss nach ihrem Beginn.');
  });

  it('keeps successful save feedback when refreshing the calendar fails', () => {
    const component = fixture.componentInstance;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updatePlan.mockImplementationOnce((_id, plan) => of({ id: savedPlan.id, ...plan }));
    component.editPlan(savedPlan);
    component.selectedDays = ['Montag'];
    component.hoursCount = 2;
    component.hours = [
      { start_time: '08:00', end_time: '08:45' },
      { start_time: '08:50', end_time: '09:35' },
    ];
    component.dayHours = {};
    refreshAllBlocks.mockImplementationOnce(() => throwError(() => new Error('Refresh failed.')));

    component.savePlan();
    fixture.detectChanges();
    consoleError.mockRestore();

    expect(component.errorMessage).toBe('');
    expect(component.successMessage).toBe('');
    expect(component.warningMessage).toContain('Plan wurde gespeichert.');
    expect(toastShow).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent)
      .toContain('Der Kalender konnte nicht aktualisiert werden');
  });

  it('uses the plan-learn library when filling activities individually', () => {
    const component = fixture.componentInstance;
    component.setupStep = false;
    component.uniformActivities = false;
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-plan-details lib-plan-learn')).not.toBeNull();
  });

  it('opens an existing plan in the full-width editor view', () => {
    const component = fixture.componentInstance;
    const setupViewChange = vi.fn();
    component.setupViewChange.subscribe(setupViewChange);

    component.editPlan(savedPlan);

    expect(setupViewChange).toHaveBeenCalledWith(true);
  });

  it('shows all tasks without a category filter and limits tasks to the selected category', () => {
    const details = new PlanDetailsComponent();
    details.tasks = [
      { id: 1, title: 'Lesen', color: '#228be6', category_id: 8, category_label: 'Schule', member_ids: [] },
      { id: 2, title: 'Fußball', color: '#40c057', category_id: 9, category_label: 'Freizeit', member_ids: [] },
    ];

    expect(details.availableTasks.map((task) => task.id)).toEqual([2, 1]);
    details.selectedCategoryId = 9;
    expect(details.availableTasks.map((task) => task.id)).toEqual([2]);
  });

  it('lets selected weekdays use individual times and hour counts', () => {
    const component = fixture.componentInstance;
    component.setupStep = false;
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    component.planName = 'Individuelle Zeiten';
    component.onUniformCountChange(false);
    fixture.detectChanges();

    const dayCounts = Array.from(element.querySelectorAll<HTMLInputElement>('.weekday-choice input[type="number"]'));
    expect(dayCounts).toHaveLength(5);
    expect(dayCounts.map((input) => input.value)).toEqual(['1', '1', '1', '1', '1']);

    component.onUniformTimeChange(false);
    fixture.detectChanges();
    expect(element.querySelectorAll('.day-hours-section')).toHaveLength(5);
    component.onDayCountChange('Montag', 2);
    component.dayHours['Montag'][0] = { start_time: '08:00', end_time: '08:45' };
    component.dayHours['Montag'][1] = { start_time: '09:00', end_time: '09:45' };
    component.dayHours['Mittwoch'][0] = { start_time: '10:00', end_time: '10:45' };
    component.savePlan();

    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({
      uniform_time: false,
      uniform_count: false,
      hours_count: 2,
      day_hours: expect.objectContaining({
        Montag: [
          { start_time: '08:00', end_time: '08:45' },
          { start_time: '09:00', end_time: '09:45' },
        ],
        Mittwoch: [{ start_time: '10:00', end_time: '10:45' }],
      }),
    }));
  });

  it('rejects overlapping times within an individual weekday', () => {
    const component = fixture.componentInstance;
    component.setupStep = false;
    fixture.detectChanges();
    component.planName = 'Überschneidung';
    component.selectedDays = ['Montag'];
    component.uniformTime = false;
    component.dayHours = {
      Montag: [
        { start_time: '08:00', end_time: '09:00' },
        { start_time: '08:45', end_time: '09:30' },
      ],
    };

    component.savePlan();

    expect(createPlan).not.toHaveBeenCalled();
    expect(component.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'hour',
        day: 'Montag',
        hourIndex: 0,
        message: 'Montag, 1. Stunde überschneidet sich mit 2. Stunde.',
      }),
      expect.objectContaining({
        target: 'hour',
        day: 'Montag',
        hourIndex: 1,
        message: 'Montag, 2. Stunde überschneidet sich mit 1. Stunde.',
      }),
    ]));
    expect(toastShow).toHaveBeenCalledWith(false, expect.stringContaining('überschneidet sich'));
  });
});
