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
import { ApiService, GERMAN_STATES, PersonEventType, PlanConflict, PlanConflictResolution, PlanDefinition, PlanSubject } from '../../../../../../services/api.service';
import { CalendarService, Category, User } from '../../../../../../services/calendar.service';
import { ToastService } from '../../../../../../services/toast.service';
import { AdminEditorActions } from '../../../action-footer/action-footer.component';
import { ColorPickerComponent } from '../../color-picker/color-picker.component';
import {
  PlanLearn,
  type PlanCategory,
  type PlanDay,
  type PlanEntry,
  type PlanEntryChange,
  type PlanSubject as PlanLearnSubject,
  type PlanTimeSlot,
} from 'plan-learn';

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
  imports: [CommonModule, FormsModule, ColorPickerComponent, PlanLearn],
  templateUrl: './member-details.component.html',
  styleUrl: './member-details.component.css',
})
export class MemberDetailsComponent implements OnChanges, OnInit, OnDestroy {
  @Input({ required: true }) user!: User;
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toastService = inject(ToastService);

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
  eventTypesLoading = false;
  eventTypeError = '';
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
    this.eventTypesLoading = false;
    this.profileSaving = false;
    this.eventTypeError = '';
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

  getScheduleEntry(day: string, period: number): ScheduleEntry | undefined {
    return this.scheduleEntries.find((entry) => entry.day_of_week === day && entry.period === period);
  }

  get planLearnDays(): readonly PlanDay[] {
    return this.scheduleDays.map((day) => ({ id: day, name: day }));
  }

  get planLearnTimeSlots(): readonly PlanTimeSlot[] {
    return (this.selectedPlan?.hours ?? []).map((hour, index) => ({
      id: String(index + 1),
      start: hour.start_time,
      end: hour.end_time,
      label: `${index + 1}.`,
    }));
  }

  get planLearnCategories(): readonly PlanCategory[] {
    const categories = this.savedCategories.map((category) => ({
      id: String(category.id),
      name: category.label,
    }));
    const categoryIds = new Set(this.savedCategories.map((category) => category.id));
    if (this.personEventTypes.some((item) => item.category_id == null || !categoryIds.has(item.category_id))) {
      categories.push({ id: 'event-types', name: 'Fächer und Eventarten' });
    }
    return categories;
  }

  get planLearnSubjects(): readonly PlanLearnSubject[] {
    const categoryIds = new Set(this.savedCategories.map((category) => category.id));
    return this.personEventTypes.map((eventType) => ({
      id: String(eventType.id),
      categoryId: eventType.category_id != null && categoryIds.has(eventType.category_id)
        ? String(eventType.category_id)
        : 'event-types',
      name: eventType.name,
      color: eventType.color,
    }));
  }

  get planLearnEntries(): readonly PlanEntry[] {
    return this.scheduleEntries
      .filter((entry): entry is ScheduleEntry & { event_type_id: number } => entry.event_type_id !== null)
      .map((entry) => ({
        dayId: entry.day_of_week,
        timeSlotId: String(entry.period),
        subjectId: String(entry.event_type_id),
        hidden: !entry.visible,
      }));
  }

  onPlanEntryChange(change: PlanEntryChange): void {
    const period = Number(change.timeSlotId);
    const entry = this.getScheduleEntry(change.dayId, period);
    if (!entry) {
      console.error('Der Stundenplan hat eine unbekannte Zelle gemeldet:', change);
      return;
    }

    if (change.subjectId === null) {
      entry.event_type_id = null;
    } else {
      const eventTypeId = Number(change.subjectId);
      if (!Number.isInteger(eventTypeId) || !this.personEventTypes.some((item) => item.id === eventTypeId)) {
        console.error('Der Stundenplan hat ein unbekanntes Fach oder eine unbekannte Eventart gemeldet:', change);
        return;
      }
      entry.event_type_id = eventTypeId;
    }
    this.publishEditorActions();
  }

  onPlanHideRequested(change: PlanEntry): void {
    const entry = this.getScheduleEntry(change.dayId, Number(change.timeSlotId));
    if (!entry || !this.personEventTypes.some((item) => String(item.id) === change.subjectId)) {
      console.error('Der Stundenplan hat eine unbekannte Sichtbarkeitsänderung gemeldet:', change);
      return;
    }
    entry.visible = !change.hidden;
    this.publishEditorActions();
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
    const userId = this.user.id;
    const profileSnapshotToSave = this.profileSnapshot();
    const profileToSave = {
      name: this.name.trim(),
      role: this.role,
      color_code: this.colorCode,
      current_points: this.currentPoints,
      status_school: this.schoolStatus,
      status_sport: this.sportStatus,
      state_code: this.stateCode,
      is_active: this.isActive,
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
        this.colorCode = savedUser.color_code;
        this.currentPoints = savedUser.current_points;
        this.schoolStatus = savedUser.status_school;
        this.sportStatus = savedUser.status_sport;
        this.stateCode = savedUser.state_code;
        this.isActive = savedUser.is_active;
        this.savedProfileSnapshot = this.profileSnapshot();
        this.loadPersonEventTypes(savedUser.id);
        this.selectedPlanId = savedUser.assigned_plan_id;
        this.loadPlans();
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
      this.name, this.role, this.colorCode, this.currentPoints,
      this.schoolStatus, this.sportStatus, this.stateCode, this.isActive,
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
    if (!plan || this.scheduleEntries.length === 0) {
      this.planError = 'Bitte zuerst einen gültigen Plan auswählen.';
      this.toastService.show(false, this.planError);
      return;
    }

    if (this.scheduleEntries.some((entry) => entry.event_type_id === null)) {
      this.planError = 'Bitte für jede Stunde ein Plan-Fach oder eine Eventart auswählen.';
      this.toastService.show(false, this.planError);
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
