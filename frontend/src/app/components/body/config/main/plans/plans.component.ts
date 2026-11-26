import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService, PlanDefinition, PlanHour, TaskDefinition } from '../../../../../services/api.service';
import { CalendarService } from '../../../../../services/calendar.service';
import { catchError, map, of, switchMap, TimeoutError, timeout } from 'rxjs';
import { AdminEditorActions } from '../../action-footer/action-footer.component';
import { ToastService } from '../../../../../services/toast.service';
import { Category } from '../../../../../services/calendar.service';
import { PlanDetailsComponent } from './plan-details.component';
import type { PlanValidationIssue, UnitInsertionPosition } from './plan-details.component';

@Component({
  selector: 'app-plans',
  standalone: true,
  imports: [CommonModule, FormsModule, PlanDetailsComponent],
  templateUrl: './plans.component.html',
  styleUrls: ['./plans.component.css', './plans-weekdays.css'],
})
export class PlansComponent implements OnChanges {
  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toastService = inject(ToastService);
  private pendingPlanId: number | null = null;

  @Output() plansChanged = new EventEmitter<PlanDefinition[]>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();
  @Output() setupViewChange = new EventEmitter<boolean>();
  @Input() initialPlans: PlanDefinition[] = [];
  @Input() selectedPlanId: number | null = null;
  @Input() categories: Category[] = [];
  @Input() tasks: TaskDefinition[] = [];
  @Input() tasksLoading = false;
  @Input() tasksLoadError = '';

  readonly daysOfWeek = [
    'Montag',
    'Dienstag',
    'Mittwoch',
    'Donnerstag',
    'Freitag',
    'Samstag',
    'Sonntag',
  ];
  readonly dayAbbreviations: Record<string, string> = {
    Montag: 'Mo',
    Dienstag: 'Di',
    Mittwoch: 'Mi',
    Donnerstag: 'Do',
    Freitag: 'Fr',
    Samstag: 'Sa',
    Sonntag: 'So',
  };

  plans: PlanDefinition[] = [];
  planName = '';
  selectedDays = this.daysOfWeek.slice(0, 5);
  hoursCount = 6;
  hours: PlanHour[] = this.createDefaultHours(this.hoursCount);
  uniformTime = true;
  uniformCount = true;
  uniformActivities = true;
  uniformTaskId: number | null = null;
  activitySubjects: Record<string, number[]> = {};
  dayHours: Record<string, PlanHour[]> = {};
  excludeSchoolHolidays = false;
  excludePublicHolidays = false;
  editingPlanId: number | null = null;
  setupStep = true;
  loading = false;
  saving = false;
  errorMessage = '';
  validationIssues: PlanValidationIssue[] = [];
  unitInsertionPosition: UnitInsertionPosition = 'before';
  successMessage = '';
  warningMessage = '';
  private savedFormSnapshot = '';
  private validationSnapshot = '';
  private preserveFormOnNextPlanListChange = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialPlans']) {
      this.plans = this.initialPlans;
      this.loading = false;
      if (this.preserveFormOnNextPlanListChange) {
        this.preserveFormOnNextPlanListChange = false;
      } else if (this.selectedPlanId !== null) {
        const selected = this.plans.find((plan) => plan.id === this.selectedPlanId);
        if (selected) this.editPlan(selected);
      } else {
        this.savedFormSnapshot = this.formSnapshot();
      }
      this.publishEditorActions();
      this.changeDetector.markForCheck();
    }
    if (changes['selectedPlanId'] && !changes['selectedPlanId'].firstChange) {
      if (this.selectedPlanId === null) this.resetForm();
      else this.openPlan(this.selectedPlanId);
    }
  }

  loadPlans(preserveError = false, preserveForm = false): void {
    this.loading = true;
    if (!preserveError) {
      this.errorMessage = '';
    }
    this.apiService.getPlans().pipe(timeout({ first: 15000 })).subscribe({
      next: (plans) => {
        this.plans = plans;
        this.loading = false;
        if (preserveForm) this.preserveFormOnNextPlanListChange = true;
        this.plansChanged.emit(plans);
        if (!preserveForm && this.pendingPlanId !== null) {
          const selectedPlan = plans.find((plan) => plan.id === this.pendingPlanId);
          this.pendingPlanId = null;
          if (selectedPlan) {
            this.editPlan(selectedPlan);
          } else {
            this.errorMessage = 'Der ausgewählte Plan konnte nicht gefunden werden.';
          }
        }
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.loading = false;
        if (preserveError) {
          console.error('Die Planliste konnte nach dem Speicherversuch nicht aktualisiert werden:', error);
        } else {
          this.toastService.show(false, 'Pläne konnten nicht geladen werden.');
        }
        this.changeDetector.markForCheck();
      },
    });
  }

  onHoursCountChange(value: number): void {
    const count = Math.max(1, Math.min(24, Math.trunc(Number(value) || 1)));
    const previousDayHours = new Map(
      this.selectedDays.map((day) => [day, this.getDayHours(day)]),
    );
    this.hoursCount = count;
    this.hours = this.uniformTime
      ? this.adjustHours(this.hours, count, this.unitInsertionPosition)
      : this.createDefaultHours(count);
    for (const day of this.selectedDays) {
      const oldDayHours = previousDayHours.get(day) ?? [];
      const dayCount = this.uniformCount ? count : oldDayHours.length;
      this.adjustActivityAssignments(
        day,
        oldDayHours.length,
        dayCount,
        this.unitInsertionPosition,
      );
      this.dayHours[day] = this.uniformTime
        ? this.hours.slice(0, dayCount).map((hour) => ({ ...hour }))
        : this.adjustHours(oldDayHours, dayCount, this.unitInsertionPosition);
    }
    this.publishEditorActions();
  }

  onUniformTimeChange(uniform: boolean): void {
    if (uniform === this.uniformTime) return;
    if (uniform) {
      const firstDayHours = this.selectedDays.length > 0
        ? this.getDayHours(this.selectedDays[0])
        : this.hours;
      this.hours = this.resizeHours(firstDayHours, this.hoursCount);
      for (const day of this.selectedDays) {
        this.dayHours[day] = this.hours.slice(0, this.getDayHours(day).length)
          .map((hour) => ({ ...hour }));
      }
    } else {
      for (const day of this.selectedDays) {
        this.dayHours[day] = this.resizeHours(this.getDayHours(day), this.getDayHours(day).length);
      }
    }
    this.uniformTime = uniform;
    this.publishEditorActions();
  }

  onUniformCountChange(uniform: boolean): void {
    if (uniform === this.uniformCount) return;
    if (uniform) {
      const previousDayHours = new Map(
        this.selectedDays.map((day) => [day, this.getDayHours(day)]),
      );
      this.hoursCount = Math.max(
        1,
        ...Array.from(previousDayHours.values(), (hours) => hours.length),
      );
      this.hours = this.uniformTime
        ? this.adjustHours(this.hours, this.hoursCount, this.unitInsertionPosition)
        : this.createDefaultHours(this.hoursCount);
      for (const day of this.selectedDays) {
        const oldDayHours = previousDayHours.get(day) ?? [];
        this.adjustActivityAssignments(
          day,
          oldDayHours.length,
          this.hoursCount,
          this.unitInsertionPosition,
        );
        this.dayHours[day] = this.uniformTime
          ? this.hours.map((hour) => ({ ...hour }))
          : this.adjustHours(oldDayHours, this.hoursCount, this.unitInsertionPosition);
      }
    } else {
      for (const day of this.selectedDays) {
        this.dayHours[day] = this.getDayHours(day).map((hour) => ({ ...hour }));
      }
    }
    this.uniformCount = uniform;
    this.publishEditorActions();
  }

  onUniformActivitiesChange(uniform: boolean): void {
    if (uniform === this.uniformActivities) return;
    if (!uniform) {
      for (const day of this.selectedDays) {
        this.activitySubjects[day] = this.getDayHours(day).map(() => this.uniformTaskId ?? 0);
      }
    }
    this.uniformActivities = uniform;
    this.publishEditorActions();
  }

  getDayHours(day: string): PlanHour[] {
    return this.dayHours[day] ?? this.hours.slice(0, this.hoursCount);
  }

  onDayCountChange(day: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const count = Math.max(0, Math.min(24, Math.trunc(Number(value) || 0)));
    const previousDayHours = this.getDayHours(day);
    if (count === 0) {
      this.selectedDays = this.selectedDays.filter((selectedDay) => selectedDay !== day);
      this.hoursCount = Math.max(
        1,
        ...this.selectedDays.map((selectedDay) => this.getDayHours(selectedDay).length),
      );
      this.hours = this.resizeHours(this.hours, this.hoursCount);
      this.publishEditorActions();
      return;
    }

    if (count !== previousDayHours.length && this.uniformTime) {
      this.onUniformTimeChange(false);
      this.warningMessage =
        'Für individuelle Einheiten wurden einheitliche Zeiten ausgeschaltet, damit bisherige Einheiten erhalten bleiben.';
    }

    if (!this.selectedDays.includes(day)) {
      this.selectedDays = this.daysOfWeek.filter((item) => item === day || this.selectedDays.includes(item));
    }
    this.dayHours[day] = this.adjustHours(previousDayHours, count, this.unitInsertionPosition);
    this.adjustActivityAssignments(day, previousDayHours.length, count, this.unitInsertionPosition);
    this.hoursCount = Math.max(
      1,
      ...this.selectedDays.map((selectedDay) => this.getDayHours(selectedDay).length),
    );
    this.hours = this.uniformTime
      ? this.adjustHours(this.hours, this.hoursCount, this.unitInsertionPosition)
      : this.createDefaultHours(this.hoursCount);
    if (this.uniformTime) {
      for (const selectedDay of this.selectedDays) {
        this.dayHours[selectedDay] = this.hours
          .slice(0, this.getDayHours(selectedDay).length)
          .map((hour) => ({ ...hour }));
      }
    }
    this.publishEditorActions();
  }

  onDayCountInput(day: string, event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.onDayCountChange(day, event.target.valueAsNumber);
    }
  }

  setUnitInsertionPosition(position: UnitInsertionPosition): void {
    this.unitInsertionPosition = position;
    this.publishEditorActions();
  }

  savePlan(): void {
    this.errorMessage = '';
    this.validationIssues = [];
    this.successMessage = '';
    this.warningMessage = '';

    const validationIssues = this.validatePlan();
    if (validationIssues.length > 0) {
      this.showValidationIssues(validationIssues);
      return;
    }

    const days = this.daysOfWeek.filter((day) => this.selectedDays.includes(day));
    const activitySubjects = this.uniformActivities
      ? {}
      : Object.fromEntries(days.map((day) => [
        day,
        Array.from({ length: this.getDayHours(day).length }, (_, index) => {
          const taskId = this.activitySubjects[day]?.[index];
          return typeof taskId === 'number' && Number.isInteger(taskId) && taskId > 0
            ? taskId
            : 0;
        }),
      ]));
    const payload = {
      name: this.planName.trim(),
      days,
      hours_count: this.hoursCount,
      hours: this.hours,
      uniform_time: this.uniformTime,
      uniform_count: this.uniformCount,
      uniform_activities: this.uniformActivities,
      uniform_task_id: this.uniformTaskId,
      activity_subjects: activitySubjects,
      day_hours: this.uniformTime && this.uniformCount
        ? {}
        : Object.fromEntries(days.map((day) => [day, this.getDayHours(day)])),
      exclude_school_holidays: this.excludeSchoolHolidays,
      exclude_public_holidays: this.excludePublicHolidays,
    };

    this.saving = true;
    this.publishEditorActions();
    const editingPlanId = this.editingPlanId;
    const updatingPlan = editingPlanId !== null;
    const request = editingPlanId === null
      ? this.apiService.createPlan(payload)
      : this.apiService.updatePlan(editingPlanId, payload);
    request.pipe(
      timeout({ first: 15000 }),
      switchMap((savedPlan) => {
        if (!updatingPlan) {
          return of({ savedPlan, calendarRefreshed: true });
        }
        return this.calendarService.refreshAllBlocks().pipe(
          timeout({ first: 15000 }),
          map(() => ({ savedPlan, calendarRefreshed: true })),
          catchError((error: unknown) => {
            console.error('Plan wurde gespeichert, aber der Kalender konnte nicht aktualisiert werden:', error);
            return of({ savedPlan, calendarRefreshed: false });
          }),
        );
      }),
    ).subscribe({
      next: ({ savedPlan, calendarRefreshed }) => {
        this.saving = false;
        this.plans = [
          ...this.plans.filter((plan) => plan.id !== savedPlan.id),
          savedPlan,
        ].sort((first, second) => first.id - second.id);
        this.plansChanged.emit(this.plans);
        if (updatingPlan) this.editPlan(savedPlan);
        else this.resetForm();
        this.successMessage = !updatingPlan
          ? 'Plan wurde gespeichert.'
          : calendarRefreshed
            ? 'Plan und zugehörige wiederkehrende Termine wurden aktualisiert.'
            : '';
        this.warningMessage = updatingPlan && !calendarRefreshed
          ? 'Plan wurde gespeichert. Der Kalender konnte nicht aktualisiert werden; bitte lade die Ansicht neu.'
          : '';
        this.loadPlans(false, true);
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.saving = false;
        const issues = this.getSaveValidationIssues(error);
        this.showValidationIssues(issues);
        this.warningMessage = '';
        this.loadPlans(true, true);
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
    });
  }

  editPlan(plan: PlanDefinition): void {
    this.setupStep = false;
    this.setupViewChange.emit(true);
    this.editingPlanId = plan.id;
    this.planName = plan.name;
    this.selectedDays = this.daysOfWeek.filter((day) => plan.days.includes(day));
    this.hoursCount = plan.hours_count;
    this.hours = plan.hours.map((hour) => ({ ...hour }));
    this.uniformTime = plan.uniform_time ?? true;
    this.uniformCount = plan.uniform_count ?? true;
    this.uniformActivities = plan.uniform_activities ?? true;
    this.uniformTaskId = plan.uniform_task_id ?? null;
    this.activitySubjects = Object.fromEntries(
      this.selectedDays.map((day) => [day, [...(plan.activity_subjects?.[day] ?? [])]])
    );
    this.dayHours = Object.fromEntries(this.selectedDays.map((day) => {
      const fallbackCount = this.uniformCount ? this.hoursCount : 1;
      const savedHours = plan.day_hours?.[day] ?? this.hours.slice(0, fallbackCount);
      return [day, savedHours.map((hour) => ({ ...hour }))];
    }));
    this.excludeSchoolHolidays = plan.exclude_school_holidays;
    this.excludePublicHolidays = plan.exclude_public_holidays;
    this.successMessage = '';
    this.errorMessage = '';
    this.validationIssues = [];
    this.warningMessage = '';
    this.unitInsertionPosition = 'before';
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  openPlan(planId: number): void {
    this.pendingPlanId = null;
    const plan = this.plans.find((item) => item.id === planId);
    if (plan) {
      this.editPlan(plan);
      return;
    }

    this.pendingPlanId = planId;
    if (!this.loading) {
      this.loadPlans();
    }
  }

  deletePlan(plan: PlanDefinition): void {
    if (!confirm(`Plan „${plan.name}“ wirklich löschen?`)) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.saving = true;
    this.publishEditorActions();
    this.apiService.deletePlan(plan.id).pipe(
      switchMap(() => this.calendarService.refreshAllBlocks().pipe(
        timeout({ first: 15000 }),
        map(() => true),
        catchError((error: unknown) => {
          console.error('Plan wurde gelöscht, aber der Kalender konnte nicht aktualisiert werden:', error);
          return of(false);
        }),
      )),
    ).subscribe({
      next: (calendarRefreshed) => {
        this.saving = false;
        this.plans = this.plans.filter((item) => item.id !== plan.id);
        this.plansChanged.emit(this.plans);
        this.calendarService.refreshUsers();
        if (this.editingPlanId === plan.id) {
          this.resetForm();
        }
        this.successMessage = calendarRefreshed
          ? 'Plan und zugehörige wiederkehrende Termine wurden gelöscht.'
          : 'Plan wurde gelöscht, aber der Kalender konnte nicht aktualisiert werden. Bitte aktualisieren.';
        if (!calendarRefreshed) {
          this.toastService.show(false, 'Plan wurde gelöscht, aber der Kalender konnte nicht aktualisiert werden. Bitte aktualisieren.');
        }
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.saving = false;
        this.errorMessage = 'Plan konnte nicht gelöscht werden.';
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
    });
  }

  resetForm(): void {
    this.pendingPlanId = null;
    this.editingPlanId = null;
    this.planName = '';
    this.selectedDays = this.daysOfWeek.slice(0, 5);
    this.hoursCount = 6;
    this.hours = this.createDefaultHours(this.hoursCount);
    this.uniformTime = true;
    this.uniformCount = true;
    this.uniformActivities = true;
    this.uniformTaskId = null;
    this.activitySubjects = {};
    this.dayHours = {};
    this.setupStep = true;
    this.setupViewChange.emit(false);
    this.excludeSchoolHolidays = false;
    this.excludePublicHolidays = false;
    this.errorMessage = '';
    this.validationIssues = [];
    this.successMessage = '';
    this.warningMessage = '';
    this.unitInsertionPosition = 'before';
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  cancelChanges(): void {
    this.loading = true;
    this.apiService.getPlans().pipe(timeout({ first: 15000 })).subscribe({
      next: (plans) => {
        this.plans = plans;
        this.plansChanged.emit(plans);
        const savedPlan = plans.find((plan) => plan.id === this.selectedPlanId);
        if (savedPlan) this.editPlan(savedPlan);
        else this.resetForm();
        this.loading = false;
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.toastService.show(false, 'Der gespeicherte Stand konnte nicht neu geladen werden.');
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
    });
  }

  private formSnapshot(): string {
    return JSON.stringify({
      planName: this.planName,
      selectedDays: this.selectedDays,
      hoursCount: this.hoursCount,
      hours: this.hours,
      uniformTime: this.uniformTime,
      uniformCount: this.uniformCount,
      uniformActivities: this.uniformActivities,
      uniformTaskId: this.uniformTaskId,
      activitySubjects: this.activitySubjects,
      dayHours: this.dayHours,
      excludeSchoolHolidays: this.excludeSchoolHolidays,
      excludePublicHolidays: this.excludePublicHolidays,
    });
  }

  onPlanDayToggle(day: string, selected: boolean): void {
    this.selectedDays = this.daysOfWeek.filter((item) =>
      item === day ? selected : this.selectedDays.includes(item),
    );
    if (selected) {
      const count = this.uniformCount ? this.hoursCount : 1;
      this.dayHours[day] = this.resizeHours(this.dayHours[day] ?? this.hours, count);
    }
    if (this.uniformCount && this.uniformTime) {
      this.dayHours[day] = this.hours.map((hour) => ({ ...hour }));
    }
    this.publishEditorActions();
  }

  onDayToggle(day: string, event: Event): void {
    const selected = event.target instanceof HTMLInputElement && event.target.checked;
    this.selectedDays = this.daysOfWeek.filter((item) =>
      item === day ? selected : this.selectedDays.includes(item),
    );
    if (selected) {
      const count = this.uniformCount ? this.hoursCount : 1;
      this.dayHours[day] = this.resizeHours(
        this.dayHours[day] ?? this.hours,
        count,
      );
    }
    if (this.uniformCount && this.uniformTime) {
      this.dayHours[day] = this.hours.map((hour) => ({ ...hour }));
    }
    this.publishEditorActions();
  }

  formatDays(days: string[]): string {
    return this.daysOfWeek
      .filter((day) => days.includes(day))
      .map((day) => this.dayAbbreviations[day])
      .join(', ');
  }

  advanceSetup(): void {
    if (!this.planName.trim()) {
      this.toastService.show(false, 'Bitte einen Namen für den Plan eingeben.');
      return;
    }
    this.planName = this.planName.trim();
    this.setupStep = false;
    this.setupViewChange.emit(true);
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  onFormSubmit(): void {
    if (this.editingPlanId === null && this.setupStep) {
      this.advanceSetup();
    }
  }

  publishEditorActions(): void {
    if (
      this.validationIssues.length > 0
      && this.validationSnapshot !== this.formSnapshot()
    ) {
      this.validationIssues = [];
      this.errorMessage = '';
    }
    const dirty = this.formSnapshot() !== this.savedFormSnapshot;
    const selected = this.plans.find((plan) => plan.id === this.selectedPlanId);
    if (this.editingPlanId === null && this.setupStep) {
      this.editorActionsChange.emit({
        dirty: this.planName.trim().length > 0,
        canDelete: false,
        busy: this.saving,
        showSave: true,
        showSaveLabel: true,
        hideCancel: true,
        saveLabel: 'Weiter',
        save: () => this.advanceSetup(),
        cancel: () => this.resetForm(),
      });
      return;
    }
    this.editorActionsChange.emit({
      dirty,
      canDelete: selected !== undefined,
      busy: this.saving,
      showSave: this.editingPlanId === null,
      showSaveLabel: this.editingPlanId === null,
      saveLabel: this.editingPlanId === null ? 'Plan hinzufügen' : 'Speichern',
      save: () => this.savePlan(),
      cancel: () => this.cancelChanges(),
      delete: () => {
        if (selected) this.deletePlan(selected);
      },
    });
  }

  getValidationMessage(target: PlanValidationIssue['target']): string {
    return this.validationIssues.find((issue) => issue.target === target)?.message ?? '';
  }

  private createDefaultHours(count: number): PlanHour[] {
    const intervalMinutes = Math.min(45, Math.floor((23 * 60 - 8 * 60) / count));
    return Array.from({ length: count }, (_, index) => {
      const startMinutes = 8 * 60 + index * intervalMinutes;
      const endMinutes = startMinutes + intervalMinutes;
      return {
        start_time: this.formatMinutes(startMinutes),
        end_time: this.formatMinutes(endMinutes),
      };
    });
  }

  private resizeHours(hours: PlanHour[], count: number): PlanHour[] {
    const defaults = this.createDefaultHours(count);
    return Array.from({ length: count }, (_, index) => ({
      ...(hours[index] ?? defaults[index]),
    }));
  }

  private adjustHours(
    hours: PlanHour[],
    count: number,
    position: UnitInsertionPosition,
  ): PlanHour[] {
    if (count < hours.length) {
      return (position === 'before' ? hours.slice(hours.length - count) : hours.slice(0, count))
        .map((hour) => ({ ...hour }));
    }
    if (count === hours.length) return hours.map((hour) => ({ ...hour }));
    if (hours.length === 0) return this.createDefaultHours(count);

    const addedCount = count - hours.length;
    const adjacentHour = position === 'before' ? hours[0] : hours[hours.length - 1];
    const start = this.timeToMinutes(
      position === 'before' ? adjacentHour.start_time : adjacentHour.end_time,
    );
    const duration = 30;
    const gap = 30;
    const totalAddedTime = addedCount * (duration + gap);
    const canFit = start !== null && (
      position === 'before'
        ? start >= totalAddedTime
        : start + totalAddedTime <= 24 * 60
    );
    const newHours = canFit
      ? Array.from({ length: addedCount }, (_, index) => {
        const offset = (duration + gap) * index;
        const newStart = position === 'before'
          ? start - totalAddedTime + offset
          : start + gap + offset;
        return {
          start_time: this.formatMinutes(newStart),
          end_time: this.formatMinutes(newStart + duration),
        };
      })
      : Array.from({ length: addedCount }, () => ({ start_time: '', end_time: '' }));

    return position === 'before'
      ? [...newHours, ...hours.map((hour) => ({ ...hour }))]
      : [...hours.map((hour) => ({ ...hour })), ...newHours];
  }

  private adjustActivityAssignments(
    day: string,
    previousCount: number,
    nextCount: number,
    position: UnitInsertionPosition,
  ): void {
    const difference = nextCount - previousCount;
    if (difference === 0) return;
    const existing = this.activitySubjects[day] ?? [];
    let updated: number[];
    if (difference > 0) {
      const emptySlots = Array.from({ length: difference }, () => 0);
      updated = position === 'before' ? [...emptySlots, ...existing] : [...existing, ...emptySlots];
    } else {
      const removedCount = -difference;
      updated = position === 'before'
        ? existing.slice(Math.min(removedCount, existing.length))
        : existing.slice(0, Math.max(0, existing.length - removedCount));
    }
    this.activitySubjects = { ...this.activitySubjects, [day]: updated };
  }

  private timeToMinutes(value: string): number | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  private formatMinutes(totalMinutes: number): string {
    const minutesInDay = totalMinutes % (24 * 60);
    const hours = Math.floor(minutesInDay / 60);
    const minutes = minutesInDay % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private validatePlan(): PlanValidationIssue[] {
    const issues: PlanValidationIssue[] = [];
    if (!this.planName.trim()) {
      issues.push({ target: 'name', message: 'Bitte einen Namen für den Plan eingeben.' });
    }
    if (this.selectedDays.length === 0) {
      issues.push({ target: 'weekdays', message: 'Bitte mindestens einen Wochentag auswählen.' });
      return issues;
    }

    const checkHours = (hours: PlanHour[], day?: string): void => {
      hours.forEach((hour, index) => {
        if (!hour.start_time || !hour.end_time) {
          issues.push({
            target: 'hour',
            day,
            hourIndex: index,
            field: !hour.start_time ? 'start_time' : 'end_time',
            message: `${day ? `${day}, ` : ''}${index + 1}. Stunde: Beginn und Ende müssen ausgefüllt sein.`,
          });
        } else if (hour.end_time <= hour.start_time) {
          issues.push({
            target: 'hour',
            day,
            hourIndex: index,
            field: 'end_time',
            message: `${day ? `${day}, ` : ''}${index + 1}. Stunde: Die Endzeit muss nach der Startzeit liegen.`,
          });
        }
      });

      hours.forEach((hour, index) => {
        if (!hour.start_time || !hour.end_time || hour.end_time <= hour.start_time) return;
        hours.slice(index + 1).forEach((other, offset) => {
          if (
            other.start_time
            && other.end_time
            && other.end_time > other.start_time
            && hour.start_time < other.end_time
            && hour.end_time > other.start_time
          ) {
            const otherIndex = index + offset + 1;
            issues.push({
              target: 'hour',
              day,
              hourIndex: index,
              message: `${day ? `${day}, ` : ''}${index + 1}. Stunde überschneidet sich mit ${otherIndex + 1}. Stunde.`,
            });
            issues.push({
              target: 'hour',
              day,
              hourIndex: otherIndex,
              message: `${day ? `${day}, ` : ''}${otherIndex + 1}. Stunde überschneidet sich mit ${index + 1}. Stunde.`,
            });
          }
        });
      });
    };

    if (this.uniformTime) checkHours(this.hours);
    else this.selectedDays.forEach((day) => checkHours(this.getDayHours(day), day));

    return issues;
  }

  private showValidationIssues(issues: PlanValidationIssue[]): void {
    this.validationIssues = issues;
    this.validationSnapshot = this.formSnapshot();
    const reasons = issues.map((issue) => issue.message);
    this.errorMessage = issues.length === 1
      ? issues[0].message
      : `Bitte korrigiere die rot markierten Angaben (${issues.length} Fehler).`;
    const visibleReasons = reasons.slice(0, 3).join(' ');
    const remaining = reasons.length > 3 ? ` Im Plan sind ${reasons.length - 3} weitere Fehler markiert.` : '';
    this.toastService.show(false, `Plan konnte nicht gespeichert werden: ${visibleReasons}${remaining}`);
    this.publishEditorActions();
  }

  private getSaveValidationIssues(error: unknown): PlanValidationIssue[] {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail;
      if (Array.isArray(detail)) {
        const issues = detail
          .map((item) => this.mapApiValidationIssue(item))
          .filter((issue): issue is PlanValidationIssue => issue !== null);
        if (issues.length > 0) return issues;
      }
      if (typeof detail === 'string') {
        return [{ target: this.targetForMessage(detail), message: detail }];
      }
      if (detail && typeof detail.message === 'string') {
        return [{ target: 'general', message: detail.message }];
      }
      if (error.status === 0) {
        return [{
          target: 'general',
          message: 'Der Server ist nicht erreichbar. Bitte prüfe die Verbindung; deine Änderungen bleiben im Formular.',
        }];
      }
      if (error.status > 0) {
        const statusMessages: Record<number, string> = {
          401: 'Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.',
          403: 'Du hast keine Berechtigung, diesen Plan zu speichern.',
          404: 'Der Plan wurde auf dem Server nicht gefunden.',
          409: 'Der Plan wurde zwischenzeitlich geändert. Lade ihn neu und übernimm deine Änderungen erneut.',
          422: 'Der Server hat die Planangaben abgelehnt, aber keine einzelnen Felder benannt.',
        };
        const explanation = statusMessages[error.status]
          ?? `Der Server hat das Speichern mit HTTP ${error.status} abgelehnt.`;
        return [{
          target: 'general',
          message: `${explanation} Deine Änderungen bleiben im Formular.`,
        }];
      }
    }
    if (error instanceof TimeoutError) {
      return [{
        target: 'general',
        message: 'Der Server hat innerhalb von 15 Sekunden nicht geantwortet. Deine Änderungen bleiben im Formular.',
      }];
    }
    return [{
      target: 'general',
      message: 'Keine eindeutige Servermeldung erhalten. Bitte prüfe die Verbindung; deine Änderungen bleiben im Formular.',
    }];
  }

  private mapApiValidationIssue(value: unknown): PlanValidationIssue | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as { loc?: unknown; msg?: unknown };
    if (typeof item.msg !== 'string') return null;
    const location = Array.isArray(item.loc) ? item.loc : [];
    const path = location.filter((part): part is string | number =>
      (typeof part === 'string' || typeof part === 'number') && part !== 'body',
    );
    const field = path[path.length - 1];
    let target: PlanValidationIssue['target'] = 'general';
    let day: string | undefined;
    let hourIndex: number | undefined;
    let fieldName: PlanValidationIssue['field'];
    let label = '';

    if (path[0] === 'name') {
      target = 'name';
      label = 'Planname';
    } else if (path[0] === 'days') {
      target = 'weekdays';
      label = 'Wochentage';
    } else if (path[0] === 'hours_count') {
      target = 'hours-count';
      label = 'Anzahl Einheiten';
    } else if (path[0] === 'uniform_task_id') {
      target = 'uniform-task';
      label = 'Task';
    } else if (path[0] === 'activity_subjects') {
      target = 'activity-grid';
      label = 'Planbefüllung';
    } else if (path[0] === 'hours' && typeof path[1] === 'number') {
      target = 'hour';
      hourIndex = path[1];
      fieldName = this.timeField(field);
      label = `${hourIndex + 1}. Stunde${fieldName ? `, ${this.timeFieldLabel(fieldName)}` : ''}`;
    } else if (
      path[0] === 'day_hours'
      && typeof path[1] === 'string'
      && typeof path[2] === 'number'
    ) {
      target = 'hour';
      day = path[1];
      hourIndex = path[2];
      fieldName = this.timeField(field);
      label = `${day}, ${hourIndex + 1}. Stunde${fieldName ? `, ${this.timeFieldLabel(fieldName)}` : ''}`;
    } else {
      target = this.targetForMessage(item.msg);
      label = this.validationTargetLabel(target);
    }

    const message = this.translateValidationMessage(item.msg);
    return {
      target,
      day,
      hourIndex,
      field: fieldName,
      message: label ? `${label}: ${message}` : message,
    };
  }

  private targetForMessage(message: string): PlanValidationIssue['target'] {
    const normalized = message.toLocaleLowerCase('de');
    if (normalized.includes('name') || normalized.includes('titel')) return 'name';
    if (normalized.includes('wochentag') || normalized.includes('tage')) return 'weekdays';
    if (normalized.includes('task') || normalized.includes('fach') || normalized.includes('aktivität')) {
      return 'activity-grid';
    }
    if (normalized.includes('stunde') || normalized.includes('zeit')) return 'hours';
    return 'general';
  }

  private validationTargetLabel(target: PlanValidationIssue['target']): string {
    const labels: Partial<Record<PlanValidationIssue['target'], string>> = {
      name: 'Planname',
      weekdays: 'Wochentage',
      'hours-count': 'Anzahl Einheiten',
      hours: 'Stundenzeiten',
      'uniform-task': 'Task',
      'activity-grid': 'Planbefüllung',
    };
    return labels[target] ?? '';
  }

  private timeField(field: unknown): PlanValidationIssue['field'] {
    if (field === 'start_time') return 'start_time';
    if (field === 'end_time') return 'end_time';
    return undefined;
  }

  private timeFieldLabel(field: 'start_time' | 'end_time'): string {
    return field === 'start_time' ? 'Beginn' : 'Ende';
  }

  private translateValidationMessage(message: string): string {
    const cleanMessage = message.replace(/^Value error, /, '').replace(/\.$/, '');
    if (cleanMessage === 'Field required') return 'Dieses Feld ist erforderlich.';
    if (cleanMessage.startsWith('String should match pattern')) {
      return 'Bitte eine gültige Uhrzeit im Format HH:MM angeben.';
    }
    if (cleanMessage === 'Input should be a valid integer') return 'Bitte eine ganze Zahl angeben.';
    if (cleanMessage === 'Input should be greater than or equal to 1') {
      return 'Der Wert muss mindestens 1 sein.';
    }
    if (cleanMessage === 'Input should be less than or equal to 24') {
      return 'Der Wert darf höchstens 24 sein.';
    }
    return `${cleanMessage}.`;
  }

}
