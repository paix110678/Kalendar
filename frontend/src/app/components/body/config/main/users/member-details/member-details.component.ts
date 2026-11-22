import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  Output,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY, Subscription, TimeoutError, asyncScheduler, catchError, finalize, firstValueFrom, observeOn, switchMap, timeout } from 'rxjs';
import { ApiService, GERMAN_STATES, PersonEventType, PlanAssignment, PlanConflict, PlanConflictResolution, PlanDefinition, PlanSubject } from '../../../../../../services/api.service';
import { CalendarService, Category, User } from '../../../../../../services/calendar.service';
import { ToastService } from '../../../../../../services/toast.service';
import { ActionFooterComponent, AdminEditorActions } from '../../../action-footer/action-footer.component';

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
  imports: [CommonModule, FormsModule, ActionFooterComponent],
  templateUrl: './member-details.component.html',
  styleUrls: ['./member-details.component.css', './member-details-plan-days.css'],
})
export class MemberDetailsComponent implements OnChanges, OnInit, OnDestroy {
  @Input({ required: true }) user!: User;
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toastService = inject(ToastService);

  readonly daysOfWeek = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  readonly dayAbbreviations: Record<string, string> = {
    Montag: 'Mo',
    Dienstag: 'Di',
    Mittwoch: 'Mi',
    Donnerstag: 'Do',
    Freitag: 'Fr',
    Samstag: 'Sa',
    Sonntag: 'So',
  };
  readonly bundeslaender = GERMAN_STATES;
  readonly roles: Array<{ value: User['role']; label: string }> = [
    { value: 'adult', label: 'Erwachsene' },
    { value: 'child_10', label: 'Kind (10+)' },
    { value: 'child_14', label: 'Jugendliche (14+)' },
    { value: 'patchwork_guest', label: 'Gast' },
  ];

  name = '';
  role: User['role'] = 'child_10';
  stateCode: string | null = null;

  plans: PlanDefinition[] = [];
  personEventTypes: PersonEventType[] = [];
  eventTypesLoading = false;
  eventTypeError = '';
  plansLoading = false;
  assignmentLoading = false;
  selectedPlanId: number | null = null;
  assignedPlans: PlanAssignment[] = [];
  planPickerOpen = false;
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
  private savedProfileSnapshot = '';
  private savedAssignmentSnapshot = '';
  private savedCategories: Category[] = [];

  private loadedUserId: number | null = null;
  private readonly familyDataSubscription = new Subscription();

  ngOnInit(): void {
    const familyDataChanges = this.calendarService.familyDataChanges$;
    if (familyDataChanges) {
      this.familyDataSubscription.add(
        familyDataChanges.subscribe(() => {
          if (!this.user || this.loadedUserId !== this.user.id) return;
          this.loadPersonEventTypes(this.user.id);
          this.loadPlans();
          this.loadPlanAssignments(this.user.id);
        }),
      );
    }

    const categories = this.calendarService.categories$;
    if (categories) {
      this.familyDataSubscription.add(
        categories.subscribe((items) => {
          this.savedCategories = items;
          this.changeDetector.markForCheck();
        }),
      );
    }
  }

  ngOnDestroy(): void {
    this.familyDataSubscription.unsubscribe();
  }

  ngOnChanges(): void {
    if (!this.user) return;
    if (this.loadedUserId === this.user.id) {
      if (this.profileSnapshot() === this.savedProfileSnapshot) {
        this.name = this.user.name;
        this.role = this.user.role;
        this.stateCode = this.user.state_code;
        this.savedProfileSnapshot = this.profileSnapshot();
      }
      return;
    }

    this.name = this.user.name;
    this.role = this.user.role;
    this.stateCode = this.user.state_code;
    this.savedProfileSnapshot = this.profileSnapshot();
    this.savedAssignmentSnapshot = this.assignmentSnapshot();
    this.loadedUserId = this.user.id;
    this.selectedPlanId = this.user.assigned_plan_id;
    this.personEventTypes = [];
    this.scheduleEntries = [];
    this.assignedPlans = [];
    this.assignmentLoading = false;
    this.eventTypesLoading = false;
    this.profileSaving = false;
    this.eventTypeError = '';
    this.loadPersonEventTypes(this.user.id);
    this.loadPlans();
    this.loadPlanAssignments(this.user.id);
    this.publishEditorActions();
  }

  get selectedPlan(): PlanDefinition | undefined {
    return this.plans.find((plan) => plan.id === this.selectedPlanId);
  }

  get scheduleDays(): string[] {
    const plan = this.selectedPlan;
    return plan
      ? this.daysOfWeek.filter((day) => plan.days.includes(day))
      : [];
  }

  togglePlanPicker(): void {
    this.planPickerOpen = !this.planPickerOpen;
  }

  selectAssignedPlan(planId: number): void {
    this.selectedPlanId = planId;
    const assignment = this.assignedPlans.find((item) => item.plan_id === planId);
    if (assignment && assignment.id > 0) {
      this.assignmentLoading = false;
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
    } else {
      this.selectPlan(planId);
    }
    this.publishEditorActions();
  }

  get availablePlans(): PlanDefinition[] {
    const assignedIds = new Set(this.assignedPlans.map((assignment) => assignment.plan_id));
    return this.plans.filter((plan) => !assignedIds.has(plan.id));
  }

  private loadPlanAssignments(userId: number): void {
    if (!('getUserPlanAssignments' in this.apiService)) return;
    this.apiService.getUserPlanAssignments(userId).pipe(timeout({ first: 15000 })).subscribe({
      next: (assignments) => {
        if (this.user.id !== userId) return;
        this.assignedPlans = assignments;
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (this.user.id !== userId) return;
        this.assignedPlans = [];
        this.changeDetector.markForCheck();
      },
    });
  }

  removePlanAssignment(assignmentId: number): void {
    const userId = this.user.id;
    if (assignmentId < 0) {
      const planId = -assignmentId;
      this.assignedPlans = this.assignedPlans.filter((assignment) => assignment.id !== assignmentId);
      if (this.selectedPlanId === planId) {
        this.selectedPlanId = this.assignedPlans.find((assignment) => assignment.id > 0)?.plan_id ?? null;
        this.scheduleEntries = [];
        this.assignmentTitle = '';
      }
      this.planPickerOpen = false;
      this.publishEditorActions();
      this.changeDetector.markForCheck();
      return;
    }
    if (!('deleteUserPlanAssignment' in this.apiService)) return;
    this.assignmentLoading = true;
    this.apiService.deleteUserPlanAssignment(userId, assignmentId).pipe(
      timeout({ first: 15000 }),
      catchError(() => {
        this.planError = 'Die Plan-Zuordnung konnte nicht entfernt werden.';
        this.toastService.show(false, this.planError);
        return EMPTY;
      }),
      finalize(() => {
        if (this.user.id === userId) {
          this.assignmentLoading = false;
          this.changeDetector.markForCheck();
        }
      }),
    ).subscribe({
      next: () => {
        if (this.user.id !== userId) return;
        this.assignedPlans = this.assignedPlans.filter((assignment) => assignment.id !== assignmentId);
        this.loadPlanAssignments(userId);
        this.calendarService.reloadUsers().subscribe();
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
    });
  }

  formatPlanDays(days: string[]): string {
    return this.daysOfWeek
      .filter((day) => days.includes(day))
      .map((day) => this.dayAbbreviations[day])
      .join(', ');
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
        this.toastService.show(false, this.planError);
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
    this.planPickerOpen = false;
    if (planId !== null && planId === this.user.assigned_plan_id) {
      this.loadSavedPlanAssignment(this.user.id, planId);
    } else {
      this.selectPlan(planId);
      if (planId !== null && !this.assignedPlans.some((assignment) => assignment.plan_id === planId)) {
        this.assignedPlans = [...this.assignedPlans, {
          id: -planId,
          user_id: this.user.id,
          plan_id: planId,
          title: this.selectedPlan?.name ?? '',
          events: [],
        }];
      }
    }
    this.publishEditorActions();
  }

  private loadSavedPlanAssignment(userId: number, planId: number): void {
    this.assignmentLoading = true;
    this.scheduleEntries = [];
    this.planError = '';
    this.apiService.getUserPlanAssignment(userId, planId).pipe(timeout({ first: 15000 })).subscribe({
      next: (assignment) => {
        if (this.user.id !== userId || this.selectedPlanId !== planId) return;
        this.assignmentLoading = false;
        if (!assignment || assignment.plan_id !== planId) {
          this.planError = 'Die gespeicherte Plan-Zuordnung für diese Person wurde nicht gefunden.';
          this.toastService.show(false, this.planError);
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
        this.toastService.show(false, this.planError);
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

    const scheduledDays = this.daysOfWeek.filter((day) => plan.days.includes(day));
    if (scheduledDays.length === 0) {
      this.planError = 'Der Plan enthält keine gültigen Wochentage.';
      return;
    }

    for (const day of scheduledDays) {
      const hours = plan.day_hours?.[day] ?? plan.hours;
      hours.forEach((hour, index) => {
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

  get conflictDialogActions(): AdminEditorActions {
    return {
      dirty: true,
      canDelete: false,
      busy: this.planApplying,
      saveLabel: 'Speichern',
      cancelLabel: 'Abbrechen',
      save: () => this.applyPlan(),
      cancel: () => this.closeConflictDialog(),
    };
  }

  async saveChanges(): Promise<void> {
    const userId = this.user.id;
    const profileSnapshotToSave = this.profileSnapshot();
    const profileToSave = {
      name: this.name.trim(),
      role: this.role,
      color_code: this.user.color_code,
      current_points: this.user.current_points,
      status_school: this.user.status_school,
      status_sport: this.user.status_sport,
      state_code: this.stateCode,
      is_active: this.user.is_active,
    };
    this.profileError = '';
    this.profileMessage = '';
    try {
      if (profileSnapshotToSave !== this.savedProfileSnapshot) {
        if (!profileToSave.name) {
          this.profileError = 'Bitte einen Namen eingeben.';
          this.toastService.show(false, this.profileError);
          return;
        }
        this.profileSaving = true;
        this.publishEditorActions();
        if (profileToSave.state_code) {
          await firstValueFrom(this.calendarService.ensureHolidayState(profileToSave.state_code).pipe(timeout({ first: 30000 })));
        }
        await firstValueFrom(this.calendarService.updateUserProfile(userId, profileToSave));
        if (this.user.id !== userId) return;
        this.savedProfileSnapshot = profileSnapshotToSave;
        this.profileMessage = profileToSave.state_code
          ? 'Einstellungen gespeichert; Ferien und Feiertage wurden aktualisiert.'
          : 'Einstellungen gespeichert.';
      }

      if (this.assignmentSnapshot() !== this.savedAssignmentSnapshot) {
        this.applyPlan();
      }
    } catch (error: unknown) {
      if (this.user.id !== userId) return;
      this.profileError = 'Änderungen konnten nicht vollständig gespeichert werden. Bitte prüfen und erneut versuchen.';
      if (error instanceof TimeoutError) this.toastService.show(false, this.profileError);
    } finally {
      if (this.user.id === userId) {
        this.profileSaving = false;
        this.publishEditorActions();
      }
      this.changeDetector.markForCheck();
    }
  }

  cancelChanges(): void {
    this.profileError = '';
    this.calendarService.reloadUsers().subscribe({
      next: (users) => {
        const savedUser = users.find((item) => item.id === this.user.id);
        if (!savedUser) return;
        this.user = savedUser;
        this.name = savedUser.name;
        this.role = savedUser.role;
        this.stateCode = savedUser.state_code;
        this.savedProfileSnapshot = this.profileSnapshot();
        this.loadPersonEventTypes(savedUser.id);
        this.selectedPlanId = savedUser.assigned_plan_id;
        this.loadPlans();
        this.loadPlanAssignments(savedUser.id);
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        console.error('Mitgliedsdaten konnten beim Abbrechen nicht neu geladen werden:', error);
        this.profileError = 'Der gespeicherte Stand konnte nicht neu geladen werden.';
        this.toastService.show(false, this.profileError);
      },
    });
  }

  publishEditorActions(): void {
    const dirty = this.profileSnapshot() !== this.savedProfileSnapshot
      || this.assignmentSnapshot() !== this.savedAssignmentSnapshot;
    this.editorActionsChange.emit({
      dirty,
      canDelete: false,
      busy: this.profileSaving || this.planApplying,
      save: () => { void this.saveChanges(); },
      cancel: () => this.cancelChanges(),
    });
  }

  private profileSnapshot(): string {
    return JSON.stringify([
      this.name, this.role, this.stateCode,
    ]);
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
    if (!plan) {
      this.planError = 'Bitte zuerst einen gültigen Plan auswählen.';
      this.toastService.show(false, this.planError);
      return;
    }

    const usesPlanTaskAssignments = plan.uniform_activities !== false
      || plan.days.some((day) => Array.isArray(plan.activity_subjects?.[day]));
    const hasLegacyActivities = this.scheduleEntries.length > 0
      && this.scheduleEntries.every((entry) => entry.event_type_id !== null);
    if (!usesPlanTaskAssignments && !hasLegacyActivities) {
      this.planError = 'Bitte befülle den Plan zuerst unter Einstellungen → Pläne.';
      this.toastService.show(false, this.planError);
      return;
    }
    const subjects: PlanSubject[] = usesPlanTaskAssignments
      ? []
      : this.scheduleEntries
        .filter((entry): entry is ScheduleEntry & { event_type_id: number } => entry.event_type_id !== null)
        .map((entry) => ({
          day_of_week: entry.day_of_week,
          period: entry.period,
          event_type_id: entry.event_type_id,
          visible: entry.visible,
        }));
    if (!this.assignmentTitle.trim()) {
      this.planError = 'Bitte einen Titel für die Plan-Zuordnung eingeben.';
      this.toastService.show(false, this.planError);
      return;
    }

    const resolutions: PlanConflictResolution[] = [];
    for (const conflict of this.conflicts) {
      if (!conflict.action) {
        this.planError = 'Bitte entscheide für jeden Konflikt: verschieben oder löschen.';
        this.toastService.show(false, this.planError);
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
        this.loadPlanAssignments(userId);
        this.publishEditorActions();
      },
    });
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
