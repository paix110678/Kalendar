import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, PlanDefinition, PlanHour } from '../../../services/api.service';
import { timeout } from 'rxjs';

@Component({
  selector: 'app-plans',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './plans.component.html',
  styleUrl: './plans.component.css',
})
export class PlansComponent {
  private readonly apiService = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);

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
  editingPlanId: number | null = null;
  loading = false;
  saving = false;
  errorMessage = '';
  successMessage = '';

  loadPlans(preserveError = false): void {
    this.loading = true;
    if (!preserveError) {
      this.errorMessage = '';
    }
    this.apiService.getPlans().pipe(timeout({ first: 15000 })).subscribe({
      next: (plans) => {
        this.plans = plans;
        this.loading = false;
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
    };

    this.saving = true;
    const request = this.editingPlanId === null
      ? this.apiService.createPlan(payload)
      : this.apiService.updatePlan(this.editingPlanId, payload);
    request.pipe(timeout({ first: 15000 })).subscribe({
      next: (savedPlan) => {
        this.saving = false;
        this.successMessage = this.editingPlanId === null
          ? 'Plan wurde gespeichert.'
          : 'Plan wurde aktualisiert.';
        this.plans = [
          ...this.plans.filter((plan) => plan.id !== savedPlan.id),
          savedPlan,
        ].sort((first, second) => first.id - second.id);
        this.resetForm();
        this.loadPlans();
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.saving = false;
        this.errorMessage = 'Speichern fehlgeschlagen oder die Antwort blieb aus. Die Planliste wird zur Kontrolle aktualisiert.';
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
    this.successMessage = '';
    this.errorMessage = '';
  }

  deletePlan(plan: PlanDefinition): void {
    if (!confirm(`Plan „${plan.name}“ wirklich löschen?`)) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.apiService.deletePlan(plan.id).subscribe({
      next: () => {
        this.plans = this.plans.filter((item) => item.id !== plan.id);
        if (this.editingPlanId === plan.id) {
          this.resetForm();
        }
        this.successMessage = 'Plan wurde gelöscht.';
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.errorMessage = 'Plan konnte nicht gelöscht werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  resetForm(): void {
    this.editingPlanId = null;
    this.planName = '';
    this.startDay = 'Montag';
    this.endDay = 'Freitag';
    this.hoursCount = 6;
    this.hours = this.createDefaultHours(this.hoursCount);
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
}
