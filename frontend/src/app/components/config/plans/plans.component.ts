import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService, PlanDefinition, PlanHour } from '../../../services/api.service';
import { CalendarService } from '../../../services/calendar.service';
import { catchError, map, of, switchMap, timeout } from 'rxjs';

@Component({
  selector: 'app-plans',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './plans.component.html',
  styleUrl: './plans.component.css',
})
export class PlansComponent implements OnChanges {
  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private pendingPlanId: number | null = null;

  @Output() plansChanged = new EventEmitter<PlanDefinition[]>();
  @Input() initialPlans: PlanDefinition[] = [];

  readonly daysOfWeek = [
    'Montag',
    'Dienstag',
    'Mittwoch',
    'Donnerstag',
    'Freitag',
    'Samstag',
    'Sonntag',
  ];

  plans: PlanDefinition[] = [];
  planName = '';
  startDay = 'Montag';
  endDay = 'Freitag';
  hoursCount = 6;
  hours: PlanHour[] = this.createDefaultHours(this.hoursCount);
  excludeSchoolHolidays = false;
  excludePublicHolidays = false;
  editingPlanId: number | null = null;
  loading = false;
  saving = false;
  errorMessage = '';
  successMessage = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialPlans']) {
      this.plans = this.initialPlans;
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  loadPlans(preserveError = false): void {
    this.loading = true;
    if (!preserveError) {
      this.errorMessage = '';
    }
    this.apiService.getPlans().pipe(timeout({ first: 15000 })).subscribe({
      next: (plans) => {
        this.plans = plans;
        this.loading = false;
        this.plansChanged.emit(plans);
        if (this.pendingPlanId !== null) {
          const selectedPlan = plans.find((plan) => plan.id === this.pendingPlanId);
          this.pendingPlanId = null;
          if (selectedPlan) {
            this.editPlan(selectedPlan);
          } else {
            this.errorMessage = 'Der ausgewählte Plan konnte nicht gefunden werden.';
          }
        }
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Pläne konnten nicht geladen werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  onHoursCountChange(value: number): void {
    const count = Math.max(1, Math.min(24, Math.trunc(Number(value) || 1)));
    const defaultHours = this.createDefaultHours(count);
    this.hoursCount = count;
    this.hours = Array.from({ length: count }, (_, index) =>
      this.hours[index] ?? defaultHours[index],
    );
  }

  savePlan(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.planName.trim()) {
      this.errorMessage = 'Bitte einen Namen für den Plan eingeben.';
      return;
    }
    if (this.daysOfWeek.indexOf(this.startDay) > this.daysOfWeek.indexOf(this.endDay)) {
      this.errorMessage = 'Der erste Tag muss vor oder gleich dem letzten Tag liegen.';
      return;
    }
    if (this.hours.some((hour) => !hour.start_time || !hour.end_time || hour.end_time <= hour.start_time)) {
      this.errorMessage = 'Für jede Stunde muss die Endzeit nach der Startzeit liegen.';
      return;
    }

    const payload = {
      name: this.planName.trim(),
      start_day: this.startDay,
      end_day: this.endDay,
      hours_count: this.hoursCount,
      hours: this.hours,
      exclude_school_holidays: this.excludeSchoolHolidays,
      exclude_public_holidays: this.excludePublicHolidays,
    };

    this.saving = true;
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
        this.plans = [
          ...this.plans.filter((plan) => plan.id !== savedPlan.id),
          savedPlan,
        ].sort((first, second) => first.id - second.id);
        this.plansChanged.emit(this.plans);
        this.resetForm();
        this.loadPlans();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.errorMessage = this.getSaveErrorMessage(error);
        this.loadPlans(true);
        this.changeDetector.markForCheck();
      },
    });
  }

  editPlan(plan: PlanDefinition): void {
    this.editingPlanId = plan.id;
    this.planName = plan.name;
    this.startDay = plan.start_day;
    this.endDay = plan.end_day;
    this.hoursCount = plan.hours_count;
    this.hours = plan.hours.map((hour) => ({ ...hour }));
    this.excludeSchoolHolidays = plan.exclude_school_holidays;
    this.excludePublicHolidays = plan.exclude_public_holidays;
    this.successMessage = '';
    this.errorMessage = '';
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
        this.plans = this.plans.filter((item) => item.id !== plan.id);
        this.plansChanged.emit(this.plans);
        this.calendarService.refreshUsers();
        if (this.editingPlanId === plan.id) {
          this.resetForm();
        }
        this.successMessage = calendarRefreshed
          ? 'Plan und zugehörige wiederkehrende Termine wurden gelöscht.'
          : 'Plan wurde gelöscht, aber der Kalender konnte nicht aktualisiert werden. Bitte aktualisieren.';
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.errorMessage = 'Plan konnte nicht gelöscht werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  resetForm(): void {
    this.pendingPlanId = null;
    this.editingPlanId = null;
    this.planName = '';
    this.startDay = 'Montag';
    this.endDay = 'Freitag';
    this.hoursCount = 6;
    this.hours = this.createDefaultHours(this.hoursCount);
    this.excludeSchoolHolidays = false;
    this.excludePublicHolidays = false;
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
    return 'Speichern fehlgeschlagen oder die Antwort blieb aus. Die Planliste wird zur Kontrolle aktualisiert.';
  }

}
