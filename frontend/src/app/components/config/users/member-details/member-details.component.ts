import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY, asyncScheduler, catchError, finalize, firstValueFrom, observeOn, switchMap, timeout } from 'rxjs';
import { ApiService, GERMAN_STATES, PersonEventType, PlanConflict, PlanConflictResolution, PlanDefinition, PlanSubject } from '../../../../services/api.service';
import { CalendarService, User } from '../../../../services/calendar.service';
import { AdminEditorActions } from '../../admin-editor-actions';
import { ColorPickerComponent } from '../../color-picker/color-picker.component';

type ConflictAction = '' | 'delete' | 'move';

interface ResolvableConflict extends PlanConflict {
  action: ConflictAction;
  newDay: string;
  newStart: string;
  newEnd: string;
}

interface ScheduleEntry extends Omit<PlanSubject, 'event_type_id'> {
  event_type_id: number | null;
  start_time: string;
  end_time: string;
  blockId?: number;
  visibilitySaving?: boolean;
}

@Component({
  selector: 'app-member-details',
  standalone: true,
  imports: [CommonModule, FormsModule, ColorPickerComponent],
  templateUrl: './member-details.component.html',
  styleUrl: './member-details.component.css',
})
export class MemberDetailsComponent implements OnChanges {
  @Input({ required: true }) user!: User;
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly daysOfWeek = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  readonly bundeslaender = GERMAN_STATES;
  readonly roles: Array<{ value: User['role']; label: string }> = [
    { value: 'adult', label: 'Erwachsene' },
    { value: 'child_10', label: 'Kind (10+)' },
    { value: 'child_14', label: 'Jugendliche (14+)' },
    { value: 'patchwork_guest', label: 'Gast' },
  ];

  name = '';
  role: User['role'] = 'child_10';
  colorCode = '#228be6';
  currentPoints = 0;
  schoolStatus: User['status_school'] = 'GREEN';
  sportStatus: User['status_sport'] = 'BASE';
  stateCode: string | null = null;
  isActive = true;

  plans: PlanDefinition[] = [];
  personEventTypes: PersonEventType[] = [];
  eventTypeName = '';
  eventTypeColor = '#fd7e14';
  eventTypesLoading = false;
  eventTypeSaving = false;
  eventTypeError = '';
  eventTypeMessage = '';
  plansLoading = false;
  assignmentLoading = false;
  selectedPlanId: number | null = null;
  assignmentTitle = '';
  scheduleEntries: ScheduleEntry[] = [];
  conflicts: ResolvableConflict[] = [];
  conflictDialogOpen = false;
  profileSaving = false;
  planApplying = false;
  profileMessage = '';
  profileError = '';
  planMessage = '';
  planError = '';
  selectedEventTypeId: number | null = null;
  private savedProfileSnapshot = '';
  private savedEventTypesSnapshot = '';
  private savedAssignmentSnapshot = '';

  private loadedUserId: number | null = null;

  ngOnChanges(): void {
    if (!this.user) return;
    if (this.loadedUserId === this.user.id) {
      if (this.profileSnapshot() === this.savedProfileSnapshot) {
        this.name = this.user.name;
        this.role = this.user.role;
        this.colorCode = this.user.color_code;
        this.currentPoints = this.user.current_points;
        this.schoolStatus = this.user.status_school;
        this.sportStatus = this.user.status_sport;
        this.stateCode = this.user.state_code;
        this.isActive = this.user.is_active;
        this.savedProfileSnapshot = this.profileSnapshot();
      }
      return;
    }

    this.name = this.user.name;
    this.role = this.user.role;
    this.colorCode = this.user.color_code;
    this.currentPoints = this.user.current_points;
    this.schoolStatus = this.user.status_school;
    this.sportStatus = this.user.status_sport;
    this.stateCode = this.user.state_code;
    this.isActive = this.user.is_active;
    this.savedProfileSnapshot = this.profileSnapshot();
    this.savedAssignmentSnapshot = this.assignmentSnapshot();
    this.loadedUserId = this.user.id;
    this.selectedPlanId = this.user.assigned_plan_id;
    this.personEventTypes = [];
    this.scheduleEntries = [];
    this.assignmentLoading = false;
    this.eventTypeName = '';
    this.eventTypeError = '';
    this.eventTypeMessage = '';
    this.loadPersonEventTypes(this.user.id);
    this.loadPlans();
    this.publishEditorActions();
  }

  get selectedPlan(): PlanDefinition | undefined {
    return this.plans.find((plan) => plan.id === this.selectedPlanId);
  }

  get scheduleDays(): string[] {
    const plan = this.selectedPlan;
    if (!plan) return [];
    const firstDay = this.daysOfWeek.indexOf(plan.start_day);
    const lastDay = this.daysOfWeek.indexOf(plan.end_day);
    return firstDay >= 0 && lastDay >= firstDay
      ? this.daysOfWeek.slice(firstDay, lastDay + 1)
      : [];
  }

  get schedulePeriods(): number[] {
    return this.selectedPlan?.hours.map((_, index) => index + 1) ?? [];
  }

  getScheduleEntry(day: string, period: number): ScheduleEntry | undefined {
    return this.scheduleEntries.find((entry) => entry.day_of_week === day && entry.period === period);
  }

  loadPlans(): void {
    const userId = this.user.id;
    this.plansLoading = true;
    this.apiService.getPlans().pipe(
      timeout({ first: 15000 }),
      observeOn(asyncScheduler),
    ).subscribe({
      next: (plans) => {
        if (this.user.id !== userId) return;
        this.plans = plans;
        this.plansLoading = false;
        if (this.selectedPlanId !== null && plans.some((plan) => plan.id === this.selectedPlanId)) {
          this.loadSavedPlanAssignment(userId, this.selectedPlanId);
        } else {
          this.selectedPlanId = null;
          this.scheduleEntries = [];
          this.savedAssignmentSnapshot = this.assignmentSnapshot();
        }
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (this.user.id !== userId) return;
        this.plansLoading = false;
        this.planError = 'Die Pläne konnten nicht geladen werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  private loadPersonEventTypes(userId: number): void {
    this.eventTypesLoading = true;
    this.apiService.getPersonEventTypes(userId).pipe(timeout({ first: 15000 })).subscribe({
      next: (eventTypes) => {
        if (this.user.id !== userId) return;
        this.personEventTypes = eventTypes;
        this.savedEventTypes = eventTypes.map((eventType) => ({ ...eventType }));
        this.savedEventTypesSnapshot = this.eventTypesSnapshot();
        this.eventTypesLoading = false;
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (this.user.id !== userId) return;
        this.eventTypesLoading = false;
        this.eventTypeError = 'Die persönliche Fachliste konnte nicht geladen werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  onPlanSelection(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const planId = value ? Number(value) : null;
    this.selectedPlanId = planId;
    if (planId !== null && planId === this.user.assigned_plan_id) {
      this.loadSavedPlanAssignment(this.user.id, planId);
    } else {
      this.selectPlan(planId);
    }
    this.publishEditorActions();
  }

  private loadSavedPlanAssignment(userId: number, planId: number): void {
    this.assignmentLoading = true;
    this.scheduleEntries = [];
    this.planError = '';
    this.apiService.getUserPlanAssignment(userId).pipe(timeout({ first: 15000 })).subscribe({
      next: (assignment) => {
        if (this.user.id !== userId || this.selectedPlanId !== planId) return;
        this.assignmentLoading = false;
        if (!assignment || assignment.plan_id !== planId) {
          this.planError = 'Die gespeicherte Plan-Zuordnung für diese Person wurde nicht gefunden.';
          this.changeDetector.markForCheck();
          return;
        }
        this.assignmentTitle = assignment.title;
        this.scheduleEntries = assignment.events.map((entry) => ({
          day_of_week: entry.day_of_week,
          period: entry.period,
          event_type_id: entry.event_type_id,
          visible: Boolean(entry.visible),
          start_time: entry.start_time,
          end_time: entry.end_time,
          blockId: entry.id,
        }));
        this.savedAssignmentSnapshot = this.assignmentSnapshot();
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (this.user.id !== userId || this.selectedPlanId !== planId) return;
        this.assignmentLoading = false;
        this.planError = 'Die gespeicherte Plan-Zuordnung konnte nicht geladen werden.';
        this.changeDetector.markForCheck();
      },
    });
  }

  selectPlan(planId: number | null): void {
    this.selectedPlanId = planId;
    this.assignmentLoading = false;
    this.scheduleEntries = [];
    this.conflicts = [];
    this.planError = '';
    this.planMessage = '';

    const plan = this.selectedPlan;
    if (!plan) return;
    this.assignmentTitle = plan.name;

    const firstDay = this.daysOfWeek.indexOf(plan.start_day);
    const lastDay = this.daysOfWeek.indexOf(plan.end_day);
    if (firstDay < 0 || lastDay < firstDay) {
      this.planError = 'Der Plan enthält einen ungültigen Wochentagsbereich.';
      return;
    }

    for (const day of this.daysOfWeek.slice(firstDay, lastDay + 1)) {
      plan.hours.forEach((hour, index) => {
        this.scheduleEntries.push({
          day_of_week: day,
          period: index + 1,
          event_type_id: null,
          visible: true,
          start_time: hour.start_time,
          end_time: hour.end_time,
        });
      });
    }
    this.publishEditorActions();
  }

  toggleScheduleEventVisibility(entry: ScheduleEntry): void {
    entry.visible = !entry.visible;
    this.publishEditorActions();
  }

  closeConflictDialog(): void {
    this.conflictDialogOpen = false;
  }

  get conflictDecisionsValid(): boolean {
    return this.conflicts.every((conflict) =>
      conflict.action === 'delete'
      || (conflict.action === 'move'
        && Boolean(conflict.newDay)
        && Boolean(conflict.newStart)
        && Boolean(conflict.newEnd)
        && conflict.newEnd > conflict.newStart),
    );
  }

  async saveChanges(): Promise<void> {
    this.profileError = '';
    this.profileMessage = '';
    try {
      if (this.profileSnapshot() !== this.savedProfileSnapshot) {
        if (!this.name.trim()) {
          this.profileError = 'Bitte einen Namen eingeben.';
          return;
        }
        this.profileSaving = true;
        this.publishEditorActions();
        const profile = {
          name: this.name.trim(),
          role: this.role,
          color_code: this.colorCode,
          current_points: this.currentPoints,
          status_school: this.schoolStatus,
          status_sport: this.sportStatus,
          state_code: this.stateCode,
          is_active: this.isActive,
        };
        if (this.stateCode) {
          await firstValueFrom(this.calendarService.ensureHolidayState(this.stateCode).pipe(timeout({ first: 30000 })));
        }
        await firstValueFrom(this.calendarService.updateUserProfile(this.user.id, profile));
        this.savedProfileSnapshot = this.profileSnapshot();
        this.profileMessage = this.stateCode
          ? 'Einstellungen gespeichert; Ferien und Feiertage wurden aktualisiert.'
          : 'Einstellungen gespeichert.';
      }

      for (const eventType of this.personEventTypes) {
        const saved = this.savedEventTypes.find((item) => item.id === eventType.id);
        if (saved && (saved.name !== eventType.name || saved.color !== eventType.color)) {
          const updated = await firstValueFrom(
            this.apiService.updatePersonEventType(this.user.id, eventType.id, eventType.name.trim(), eventType.color)
              .pipe(timeout({ first: 15000 })),
          );
          this.personEventTypes = this.personEventTypes.map((current) =>
            current.id === updated.id ? updated : current,
          );
        }
      }
      if (this.eventTypeName.trim()) {
        const created = await firstValueFrom(
          this.apiService.createPersonEventType(this.user.id, this.eventTypeName.trim(), this.eventTypeColor)
            .pipe(timeout({ first: 15000 })),
        );
        this.personEventTypes = [...this.personEventTypes, created].sort((a, b) => a.id - b.id);
        this.eventTypeName = '';
      }
      this.savedEventTypes = this.personEventTypes.map((eventType) => ({ ...eventType }));
      this.savedEventTypesSnapshot = this.eventTypesSnapshot();
      this.eventTypeMessage = 'Persönliche Fachliste wurde gespeichert.';
      if (this.assignmentSnapshot() !== this.savedAssignmentSnapshot) {
        this.applyPlan();
      }
    } catch (error: unknown) {
      this.profileError = 'Änderungen konnten nicht vollständig gespeichert werden. Bitte prüfen und erneut versuchen.';
      this.eventTypeError = this.getEventTypeErrorMessage(error);
    } finally {
      this.profileSaving = false;
      this.eventTypeSaving = false;
      this.publishEditorActions();
      this.changeDetector.markForCheck();
    }
  }

  cancelChanges(): void {
    this.profileError = '';
    this.eventTypeError = '';
    this.calendarService.reloadUsers().subscribe({
      next: (users) => {
        const savedUser = users.find((item) => item.id === this.user.id);
        if (!savedUser) return;
        this.user = savedUser;
        this.name = savedUser.name;
        this.role = savedUser.role;
        this.colorCode = savedUser.color_code;
        this.currentPoints = savedUser.current_points;
        this.schoolStatus = savedUser.status_school;
        this.sportStatus = savedUser.status_sport;
        this.stateCode = savedUser.state_code;
        this.isActive = savedUser.is_active;
        this.savedProfileSnapshot = this.profileSnapshot();
        this.eventTypeName = '';
        this.selectedEventTypeId = null;
        this.loadPersonEventTypes(savedUser.id);
        this.selectedPlanId = savedUser.assigned_plan_id;
        this.loadPlans();
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        console.error('Mitgliedsdaten konnten beim Abbrechen nicht neu geladen werden:', error);
        this.profileError = 'Der gespeicherte Stand konnte nicht neu geladen werden.';
      },
    });
  }

  publishEditorActions(): void {
    const dirty = this.profileSnapshot() !== this.savedProfileSnapshot
      || this.eventTypesSnapshot() !== this.savedEventTypesSnapshot
      || this.eventTypeName.trim() !== ''
      || this.assignmentSnapshot() !== this.savedAssignmentSnapshot;
    this.editorActionsChange.emit({
      dirty,
      canDelete: this.selectedEventTypeId !== null,
      busy: this.profileSaving || this.eventTypeSaving || this.planApplying,
      save: () => { void this.saveChanges(); },
      cancel: () => this.cancelChanges(),
      delete: () => this.deleteSelectedEventType(),
    });
  }

  selectEventType(eventType: PersonEventType): void {
    this.selectedEventTypeId = eventType.id;
    this.publishEditorActions();
  }

  private deleteSelectedEventType(): void {
    const eventType = this.personEventTypes.find((item) => item.id === this.selectedEventTypeId);
    if (!eventType || !confirm(`„${eventType.name}“ aus der Fachliste von ${this.user.name} löschen?`)) return;
    this.eventTypeSaving = true;
    this.apiService.deletePersonEventType(this.user.id, eventType.id).pipe(timeout({ first: 15000 })).subscribe({
      next: () => {
        this.personEventTypes = this.personEventTypes.filter((item) => item.id !== eventType.id);
        this.savedEventTypes = this.personEventTypes.map((item) => ({ ...item }));
        this.savedEventTypesSnapshot = this.eventTypesSnapshot();
        this.selectedEventTypeId = null;
        this.eventTypeSaving = false;
        this.calendarService.refreshAllBlocks().subscribe({
          error: (error: unknown) => console.error('Kalender konnte nach Löschen des persönlichen Fachs nicht aktualisiert werden:', error),
        });
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        this.eventTypeSaving = false;
        this.eventTypeError = this.getEventTypeErrorMessage(error);
        this.publishEditorActions();
      },
    });
  }

  private get savedEventTypes(): PersonEventType[] {
    return this.savedEventTypesCache;
  }
  private set savedEventTypes(value: PersonEventType[]) {
    this.savedEventTypesCache = value;
  }
  private savedEventTypesCache: PersonEventType[] = [];

  private profileSnapshot(): string {
    return JSON.stringify([
      this.name, this.role, this.colorCode, this.currentPoints,
      this.schoolStatus, this.sportStatus, this.stateCode, this.isActive,
    ]);
  }

  private eventTypesSnapshot(): string {
    return JSON.stringify(this.personEventTypes.map(({ id, name, color }) => ({ id, name, color })));
  }

  private assignmentSnapshot(): string {
    return JSON.stringify({
      planId: this.selectedPlanId,
      title: this.assignmentTitle,
      entries: this.scheduleEntries.map(({ day_of_week, period, event_type_id, visible }) =>
        ({ day_of_week, period, event_type_id, visible })),
    });
  }

  applyPlan(): void {
    if (this.conflicts.length > 0 && !this.conflictDialogOpen) {
      this.conflictDialogOpen = true;
      return;
    }
    this.planError = '';
    this.planMessage = '';
    const plan = this.selectedPlan;
    if (!plan || this.scheduleEntries.length === 0) {
      this.planError = 'Bitte zuerst einen gültigen Plan auswählen.';
      return;
    }

    if (this.scheduleEntries.some((entry) => entry.event_type_id === null)) {
      this.planError = 'Bitte für jede Stunde ein Plan-Fach oder eine Eventart auswählen.';
      return;
    }
    const subjects: PlanSubject[] = this.scheduleEntries
      .filter((entry): entry is ScheduleEntry & { event_type_id: number } => entry.event_type_id !== null)
      .map((entry) => ({
        day_of_week: entry.day_of_week,
        period: entry.period,
        event_type_id: entry.event_type_id,
        visible: entry.visible,
      }));
    if (!this.assignmentTitle.trim()) {
      this.planError = 'Bitte einen Titel für die Plan-Zuordnung eingeben.';
      return;
    }

    const resolutions: PlanConflictResolution[] = [];
    for (const conflict of this.conflicts) {
      if (!conflict.action) {
        this.planError = 'Bitte entscheide für jeden Konflikt: verschieben oder löschen.';
        return;
      }
      resolutions.push(conflict.action === 'delete'
        ? { block_id: conflict.id, action: 'delete' }
        : {
            block_id: conflict.id,
            action: 'move',
            day_of_week: conflict.newDay,
            start_time: conflict.newStart,
            end_time: conflict.newEnd,
          });
    }

    const userId = this.user.id;
    this.planApplying = true;
    this.publishEditorActions();
    this.calendarService.applyPlan(userId, plan.id, this.assignmentTitle.trim(), subjects, resolutions).pipe(
      observeOn(asyncScheduler),
      catchError((error: HttpErrorResponse) => {
        if (this.user.id === userId) this.handlePlanError(error);
        return EMPTY;
      }),
      finalize(() => {
        this.planApplying = false;
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      }),
    ).subscribe({
      next: (result) => {
        if (this.user.id !== userId) return;
        this.conflicts = [];
        this.conflictDialogOpen = false;
        this.planMessage = `${result.created_blocks} Kalenderblöcke wurden gespeichert und „${this.assignmentTitle.trim()}“ zugeordnet (Zuordnungs-ID ${result.assignment_id}).`;
        this.loadSavedPlanAssignment(userId, plan.id);
        this.publishEditorActions();
      },
    });
  }

  getEventTypeColor(eventTypeId: number | null): string {
    return this.personEventTypes.find((eventType) => eventType.id === eventTypeId)?.color ?? 'transparent';
  }

  getEventTypeTextColor(eventTypeId: number | null): string {
    const color = this.getEventTypeColor(eventTypeId);
    if (color === 'transparent') return '#212529';
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 >= 145 ? '#212529' : '#fff';
  }

  private getEventTypeErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.detail === 'string') {
      return error.error.detail;
    }
    return 'Die persönliche Fachliste konnte nicht gespeichert werden.';
  }

  private handlePlanError(error: HttpErrorResponse): void {
    const detail = error.error?.detail;
    if (error.status === 409) {
      const conflictRows = detail && typeof detail === 'object' && Array.isArray(detail.conflicts)
        ? detail.conflicts as PlanConflict[]
        : [];
      this.planError = detail && typeof detail === 'object' && typeof detail.message === 'string'
        ? detail.message
        : typeof detail === 'string'
          ? detail
          : 'Der Plan kann wegen einer Überschneidung nicht gespeichert werden. Prüfe die betroffenen Zeiten.';
      this.conflicts = conflictRows.map((conflict) => {
        const previous = this.conflicts.find((item) => item.id === conflict.id);
        return {
          ...conflict,
          action: previous?.action ?? '',
          newDay: previous?.newDay ?? conflict.day_of_week,
          newStart: previous?.newStart ?? conflict.start_time,
          newEnd: previous?.newEnd ?? conflict.end_time,
        };
      });
      this.conflictDialogOpen = true;
      return;
    }
    this.planError = typeof detail === 'string'
      ? detail
      : 'Der Plan konnte nicht übernommen werden.';
  }
}
