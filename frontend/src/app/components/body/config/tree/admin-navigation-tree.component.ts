import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  DatabaseBackup,
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
      display: 'Anzeige',
      statistics: 'Statistik',
    }[this.activeTab];
  }

  getTasksForCategory(categoryId: number): TaskDefinition[] {
    return this.tasks
      .filter((task) => task.category_id === categoryId)
      .sort((left, right) => left.title.localeCompare(right.title, 'de'));
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
