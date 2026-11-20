import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService, PlanDefinition, PlanHour, TaskDefinition } from '../../../../../services/api.service';
import { CalendarService } from '../../../../../services/calendar.service';
import { catchError, map, of, switchMap, timeout } from 'rxjs';
import { AdminEditorActions } from '../../action-footer/action-footer.component';
import { ToastService } from '../../../../../services/toast.service';
import { Category } from '../../../../../services/calendar.service';
import { PlanDetailsComponent } from './plan-details.component';

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
  successMessage = '';
  private savedFormSnapshot = '';
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
      error: () => {
        this.loading = false;
        this.toastService.show(false, 'Pläne konnten nicht geladen werden.');
        this.changeDetector.markForCheck();
      },
    });
  }

  onHoursCountChange(value: number): void {
    const count = Math.max(1, Math.min(24, Math.trunc(Number(value) || 1)));
    this.hoursCount = count;
    this.hours = this.resizeHours(this.hours, count);
    for (const day of this.selectedDays) {
      const dayCount = this.uniformCount ? count : this.getDayHours(day).length;
      this.dayHours[day] = this.uniformTime
        ? this.hours.slice(0, dayCount).map((hour) => ({ ...hour }))
        : this.resizeHours(this.dayHours[day] ?? this.hours, dayCount);
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
      this.hoursCount = Math.max(
        1,
        ...this.selectedDays.map((day) => this.getDayHours(day).length),
      );
      this.hours = this.resizeHours(this.hours, this.hoursCount);
      for (const day of this.selectedDays) {
        this.dayHours[day] = this.uniformTime
          ? this.hours.map((hour) => ({ ...hour }))
          : this.resizeHours(this.dayHours[day] ?? this.hours, this.hoursCount);
      }
    } else {
      this.hoursCount = 1;
      this.hours = this.resizeHours(this.hours, 1);
      for (const day of this.selectedDays) {
        this.dayHours[day] = this.resizeHours(this.getDayHours(day), 1);
      }
    }
    this.uniformCount = uniform;
    this.publishEditorActions();
  }

  onUniformActivitiesChange(uniform: boolean): void {
    if (uniform === this.uniformActivities) return;
    this.uniformActivities = uniform;
    this.publishEditorActions();
  }

  getDayHours(day: string): PlanHour[] {
    return this.dayHours[day] ?? this.hours.slice(0, this.hoursCount);
  }

  onDayCountChange(day: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const count = Math.max(0, Math.min(24, Math.trunc(Number(value) || 0)));
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

    if (!this.selectedDays.includes(day)) {
      this.selectedDays = this.daysOfWeek.filter((item) => item === day || this.selectedDays.includes(item));
    }
    this.dayHours[day] = this.resizeHours(this.dayHours[day] ?? this.hours, count);
    this.hoursCount = Math.max(
      1,
      ...this.selectedDays.map((selectedDay) => this.getDayHours(selectedDay).length),
    );
    this.hours = this.resizeHours(this.hours, this.hoursCount);
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

  savePlan(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.planName.trim()) {
      this.toastService.show(false, 'Bitte einen Namen für den Plan eingeben.');
      return;
    }
    if (this.selectedDays.length === 0) {
      this.toastService.show(false, 'Bitte mindestens einen Wochentag auswählen.');
      return;
    }
    const hoursByDay = this.selectedDays.map((day) => this.getDayHours(day));
    if (hoursByDay.some((hours) =>
      hours.some((hour) => !hour.start_time || !hour.end_time || hour.end_time <= hour.start_time),
    )) {
      this.toastService.show(false, 'Für jede Stunde muss die Endzeit nach der Startzeit liegen.');
      return;
    }
    if (hoursByDay.some((hours) => hours.some((hour, index) =>
      hours.slice(index + 1).some((other) =>
        hour.start_time < other.end_time && hour.end_time > other.start_time,
      ),
    ))) {
      this.toastService.show(false, 'Die Stundenzeiten dürfen sich innerhalb eines Wochentags nicht überschneiden.');
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
        this.successMessage = !updatingPlan
          ? 'Plan wurde gespeichert.'
          : calendarRefreshed
            ? 'Plan und zugehörige wiederkehrende Termine wurden aktualisiert.'
            : 'Plan wurde gespeichert, aber der Kalender konnte nicht aktualisiert werden. Bitte aktualisieren.';
        if (!calendarRefreshed) {
          this.toastService.show(false, 'Plan wurde gespeichert, aber der Kalender konnte nicht aktualisiert werden. Bitte aktualisieren.');
        }
        this.plans = [
          ...this.plans.filter((plan) => plan.id !== savedPlan.id),
          savedPlan,
        ].sort((first, second) => first.id - second.id);
        this.plansChanged.emit(this.plans);
        if (updatingPlan) this.editPlan(savedPlan);
        else this.resetForm();
        this.loadPlans();
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.errorMessage = this.getSaveErrorMessage(error);
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

  private formatMinutes(totalMinutes: number): string {
    const minutesInDay = totalMinutes % (24 * 60);
    const hours = Math.floor(minutesInDay / 60);
    const minutes = minutesInDay % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private getSaveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail;
      if (typeof detail === 'string') return detail;
      if (detail && typeof detail.message === 'string') return detail.message;
    }
    return 'Speichern fehlgeschlagen oder die Antwort blieb aus. Deine Änderungen bleiben im Formular.';
  }

}
