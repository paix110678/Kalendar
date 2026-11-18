import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, PlanDefinition } from '../../../../../services/api.service';
import { CalendarService } from '../../../../../services/calendar.service';
import { ToastService } from '../../../../../services/toast.service';
import { PlansComponent } from './plans.component';

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
  const toastShow = vi.fn();

  beforeEach(async () => {
    createPlan.mockClear();
    toastShow.mockClear();
    await TestBed.configureTestingModule({
      imports: [PlansComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            createPlan,
            getPlans: vi.fn(() => of([savedPlan])),
          },
        },
        { provide: CalendarService, useValue: {} },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlansComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows seven abbreviated weekday checkboxes and saves the selected days', () => {
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const weekdayLabels = Array.from(element.querySelectorAll('.weekday-choice span'))
      .map((label) => label.textContent?.trim());

    expect(weekdayLabels).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(element.querySelectorAll('.weekday-choice input')).toHaveLength(7);
    expect(Array.from(element.querySelectorAll<HTMLInputElement>('.plan-mode-options input'))
      .every((input) => input.checked)).toBe(true);
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
    component.planName = 'Ohne Wochentag';
    component.selectedDays = [];

    component.savePlan();

    expect(createPlan).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(false, 'Bitte mindestens einen Wochentag auswählen.');
  });

  it('lets selected weekdays use individual times and hour counts', () => {
    const component = fixture.componentInstance;
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
    expect(toastShow).toHaveBeenCalledWith(
      false,
      'Die Stundenzeiten dürfen sich innerhalb eines Wochentags nicht überschneiden.',
    );
  });
});
