import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  DatabaseBackup,
  FamilyTask,
  GERMAN_STATES,
  PlanDefinition,
  TaskDefinition,
  WeatherLocation,
} from '../../../../services/api.service';
import { Category, User } from '../../../../services/calendar.service';
import { AccountInvitationRecord, AuthAccount } from '../../../../services/auth.service';
import { AdminNavigationAction, AdminTab } from '../menu/admin-navigation.component';

@Component({
  selector: 'app-admin-navigation-tree',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-navigation-tree.component.html',
  styleUrl: './admin-navigation-tree.component.css',
})
export class AdminNavigationTreeComponent {
  @Input() activeUsers: User[] = [];
  @Input() activeTab: AdminTab = 'users';
  @Input() accounts: AuthAccount[] = [];
  @Input() invitations: AccountInvitationRecord[] = [];
  @Input() accountsLoading = false;
  @Input() accountsError = '';
  @Input() selectedAccountItemId: string | null = null;
  @Input() selectedMemberId: number | null = null;
  @Input() expandedSections: Record<
    'plans' | 'holidays' | 'categories' | 'system' | 'database',
    boolean
  > = {
    plans: false,
    holidays: false,
    categories: false,
    system: false,
    database: false,
  };
  @Input() savedPlans: PlanDefinition[] = [];
  @Input() selectedPlanId: number | null = null;
  @Input() plansLoading = false;
  @Input() plansLoadError = '';
  @Input() savedHolidayStates: string[] = [];
  @Input() selectedHolidayState: string | null = null;
  @Input() holidaysLoading = false;
  @Input() holidaysLoadError = '';
  @Input() calendarCategories: Category[] = [];
  @Input() selectedCategoryId: number | null = null;
  @Input() tasks: TaskDefinition[] = [];
  @Input() tasksLoading = false;
  @Input() tasksLoadError = '';
  @Input() selectedTaskId: number | null = null;
  @Input() selectedTaskCategoryId: number | null = null;
  @Input() familyTasks: FamilyTask[] = [];
  @Input() familyTasksLoading = false;
  @Input() familyTasksLoadError = '';
  @Input() selectedFamilyTaskId: number | null = null;
  @Input() selectedFamilyTaskMemberId: number | null = null;
  @Input() selectedFamilyTaskParentId: number | null = null;
  @Input() weatherLocations: WeatherLocation[] = [];
  @Input() weatherLocationsLoading = false;
  @Input() weatherLocationsError = '';
  @Input() selectedWeatherLocationId: number | null = null;
  @Input() databaseBackups: DatabaseBackup[] = [];
  @Input() databaseBackupErrors: Array<{ file: string; error: string }> = [];
  @Input() databaseBackupsLoading = false;
  @Input() databaseBackupsError = '';
  @Input() selectedDatabaseBackupId: string | null = null;

  @Output() action = new EventEmitter<AdminNavigationAction>();

  get title(): string {
    return {
      users: 'Familienmitglieder',
      plans: 'Gespeicherte Pläne',
      holidays: 'Bundesländer',
      categories: 'Kategorien und Tasks',
      tasks: 'Kategorien und Tasks',
      system: 'Wetterstandorte',
      database: 'Datenbank-Backups',
      accounts: 'Konten',
      statistics: 'Statistik',
      familyTasks: 'Aufgaben',
    }[this.activeTab];
  }

  getTasksForCategory(categoryId: number): TaskDefinition[] {
    return this.tasks
      .filter((task) => task.category_id === categoryId)
      .sort((left, right) => left.title.localeCompare(right.title, 'de'));
  }

  getFamilyTasksForMember(memberId: number): FamilyTask[] {
    const memberTasks = this.familyTasks.filter(
      (task) => task.member_id === memberId && task.parent_id === null,
    );
    const tasksBySeries = new Map<number, FamilyTask>();
    const standaloneTasks = memberTasks.filter((task) => task.series_id == null);
    for (const task of memberTasks) {
      if (task.series_id == null) continue;
      const current = tasksBySeries.get(task.series_id);
      if (!current || this.compareSeriesRepresentatives(task, current) < 0) {
        tasksBySeries.set(task.series_id, task);
      }
    }
    return [...standaloneTasks, ...tasksBySeries.values()].sort((left, right) =>
      left.due_date.localeCompare(right.due_date)
      || left.title.localeCompare(right.title, 'de'),
    );
  }

  getFamilySubtasks(parentId: number): FamilyTask[] {
    return this.familyTasks
      .filter((task) => task.parent_id === parentId)
      .sort((left, right) =>
        left.due_date.localeCompare(right.due_date)
        || left.title.localeCompare(right.title, 'de'),
      );
  }

  formatTaskDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
  }

  familyTaskDescription(task: FamilyTask): string {
    if (!task.repeat_weekdays?.length) {
      return `${this.formatTaskDate(task.due_date)}${task.points > 0 ? ' · ' + task.points + ' Punkte' : ''}`;
    }
    const abbreviations: Record<string, string> = {
      Montag: 'Mo',
      Dienstag: 'Di',
      Mittwoch: 'Mi',
      Donnerstag: 'Do',
      Freitag: 'Fr',
      Samstag: 'Sa',
      Sonntag: 'So',
    };
    const repeatDays = task.repeat_weekdays.map((day) => abbreviations[day] ?? day);
    const start = task.series_start_date
      ? ` · ab ${this.formatTaskDate(task.series_start_date)}`
      : '';
    const end = task.series_end_date
      ? ` · bis ${this.formatTaskDate(task.series_end_date)}`
      : ' · ohne Enddatum';
    const points = task.points > 0 ? ` · ${task.points} Punkte` : '';
    return `Wöchentlich ${repeatDays.join(', ')}${start}${end}${points}`;
  }

  private compareSeriesRepresentatives(left: FamilyTask, right: FamilyTask): number {
    const today = this.todayKey();
    const leftCurrent = !left.completed && left.due_date >= today;
    const rightCurrent = !right.completed && right.due_date >= today;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return left.due_date.localeCompare(right.due_date);
  }

  private todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  get pendingInvitations(): AccountInvitationRecord[] {
    return this.invitations.filter((invitation) => invitation.status === 'pending');
  }

  holidayStateName(code: string): string {
    return GERMAN_STATES.find((state) => state.code === code)?.name ?? code;
  }

  databaseBackupLabel(backup: DatabaseBackup): string {
    const date = new Date(backup.created_at);
    if (Number.isNaN(date.getTime())) return backup.id;
    return `${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date)} · ${backup.id.slice(-6)}`;
  }

  accountItemId(account: AuthAccount): string {
    return `account:${account.id}`;
  }

  invitationItemId(invitation: AccountInvitationRecord): string {
    return `invitation:${invitation.id}`;
  }

  emit(
    type: AdminNavigationAction['type'],
    id?: number | string | null,
    categoryId?: number | null,
  ): void {
    this.action.emit({ type, id, categoryId });
  }
}
