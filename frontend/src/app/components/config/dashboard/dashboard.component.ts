import { Component, Input, Output, EventEmitter, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, DatabaseBackup, DatabaseBackupList, GERMAN_STATES, Holiday, HolidayStateData, PlanDefinition, TaskDefinition, WeatherLocation } from '../../../services/api.service';
import { CalendarService, Category } from '../../../services/calendar.service';
import { Subscription } from 'rxjs';

// Importpfade matchen exakt zu euren neuen, sauberen Geschwister-Ordnern
import { UsersComponent } from '../users/users.component';
import { AccountManagementComponent } from '../users/account-management.component';
import { CategoriesComponent } from '../categories/categories.component';
import { SystemComponent } from '../weather/system.component';
import { DatabaseComponent } from '../database/database.component';
import { PlansComponent } from '../plans/plans.component';
import { HolidaysComponent } from '../holidays/holidays.component';
import { TasksComponent } from '../tasks/tasks.component';
import { HeaderSettingsComponent } from '../header-settings/header-settings.component';
import { User } from '../../../services/calendar.service';
import { AdminEditorActions } from '../admin-editor-actions';
import { EditorActionsFooterComponent } from '../editor-actions-footer/editor-actions-footer.component';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    UsersComponent, 
    AccountManagementComponent,
    CategoriesComponent, 
    SystemComponent, 
    DatabaseComponent,
    PlansComponent,
    HolidaysComponent,
    TasksComponent,
    HeaderSettingsComponent,
    EditorActionsFooterComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  @Input() activeUsers: User[] = [];
  @Input() activeRewards: any[] = [];
  
  // REPARIERT: Stellt das vom Shell-Template gesuchte Eingangsfeld fehlerfrei wieder her!
  @Input() selectedUser: any = null;
  
  @Output() closeAdmin = new EventEmitter<void>();

  @ViewChild(PlansComponent) private plansComponent?: PlansComponent;

  public activeTab: 'users' | 'accounts' | 'plans' | 'holidays' | 'categories' | 'system' | 'database' | 'tasks' | 'header' = 'users';
  public selectedMemberId: number | null = null;
  public savedPlans: PlanDefinition[] = [];
  public selectedPlanId: number | null = null;
  public plansLoading = false;
  public plansLoadError = '';
  public savedHolidayStates: string[] = [];
  public savedHolidays: Holiday[] = [];
  public selectedHolidayState: string | null = null;
  public holidaysLoading = false;
  public holidaysLoadError = '';
  public dbTables: string[] = [];
  public databaseBackups: DatabaseBackup[] = [];
  public databaseBackupErrors: Array<{ file: string; error: string }> = [];
  public databaseBackupsLoading = false;
  public databaseBackupsError = '';
  public selectedDatabaseBackupId: string | null = null;
  public weatherLocations: WeatherLocation[] = [];
  public weatherLocationsLoading = false;
  public weatherLocationsError = '';
  public selectedWeatherLocationId: number | null = null;
  public calendarCategories: Category[] = [];
  public selectedCategoryId: number | null = null;
  public tasks: TaskDefinition[] = [];
  public tasksLoading = false;
  public tasksLoadError = '';
  public selectedTaskId: number | null = null;
  public expandedSections: Record<'plans' | 'holidays' | 'categories' | 'system' | 'database', boolean> = {
    plans: false,
    holidays: false,
    categories: false,
    system: false,
    database: false,
  };
  public editorActions: AdminEditorActions | null = null;
  public editorMessage = '';
  public editorError = false;
  private readonly subscriptions = new Subscription();

  constructor(
    private apiService: ApiService,
    private calendarService: CalendarService,
    private readonly authService: AuthService,
  ) {}

  get isAdmin(): boolean {
    return this.authService.currentAccount?.role === 'admin';
  }

  ngOnInit(): void {
    this.subscriptions.add(this.calendarService.categories$.subscribe((categories) => {
      this.calendarCategories = categories;
      if (this.selectedCategoryId !== null
        && !categories.some((category) => category.id === this.selectedCategoryId)) {
        this.selectedCategoryId = null;
      }
    }));
    this.subscriptions.add(this.calendarService.savedPlansState$.subscribe((state) => {
      if (state.data !== null) this.savedPlans = state.data;
      this.plansLoading = state.loading;
      this.plansLoadError = state.error ?? '';
    }));
    this.subscriptions.add(this.calendarService.savedHolidayDataState$.subscribe((state) => {
      if (state.data !== null) {
        this.savedHolidayStates = state.data.states;
        this.savedHolidays = state.data.holidays;
      }
      this.holidaysLoading = state.loading;
      this.holidaysLoadError = state.error ?? '';
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  openPlans(): void {
    this.editorActions = null;
    const shouldLoad = !this.expandedSections.plans;
    this.expandedSections.plans = true;
    this.activeTab = 'plans';
    this.selectedPlanId = null;
    if (shouldLoad) this.refreshSavedPlans();
    this.plansComponent?.resetForm();
  }

  openSavedPlan(planId: number): void {
    this.editorActions = null;
    this.expandedSections.plans = true;
    this.activeTab = 'plans';
    this.selectedPlanId = planId;
    setTimeout(() => {
      if (this.activeTab === 'plans') {
        this.plansComponent?.openPlan(planId);
      }
    }, 50);
  }

  refreshSavedPlans(): void {
    this.calendarService.loadSavedPlans();
  }

  onPlansChanged(plans: PlanDefinition[]): void {
    this.savedPlans = plans;
    this.calendarService.setSavedPlans(plans);
    if (this.selectedPlanId !== null && !plans.some((plan) => plan.id === this.selectedPlanId)) {
      this.selectedPlanId = null;
    }
  }

  openHolidays(stateCode: string | null = null): void {
    this.editorActions = null;
    const shouldLoad = !this.expandedSections.holidays;
    this.expandedSections.holidays = true;
    this.activeTab = 'holidays';
    this.selectedHolidayState = stateCode;
    if (stateCode === null && shouldLoad) this.refreshSavedHolidays();
  }

  openCategories(categoryId: number | null = null): void {
    this.editorActions = null;
    const shouldLoad = !this.expandedSections.categories;
    this.activeTab = 'categories';
    this.selectedCategoryId = categoryId;
    this.selectedTaskId = null;
    this.selectedTaskCategoryId = null;
    this.expandedSections.categories = true;
    if (categoryId === null && shouldLoad) {
      this.calendarService.loadCategories();
      this.refreshSavedTasks();
    }
  }

  openTask(taskId: number | null, categoryId: number | null = null): void {
    this.editorActions = null;
    this.activeTab = 'tasks';
    this.selectedTaskId = taskId;
    this.selectedTaskCategoryId = categoryId;
    this.expandedSections.categories = true;
  }

  openHeaderSettings(): void {
    this.editorActions = null;
    this.activeTab = 'header';
  }

  public selectedTaskCategoryId: number | null = null;

  refreshSavedTasks(): void {
    this.tasksLoading = true;
    this.tasksLoadError = '';
    this.apiService.getTasks().subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.tasksLoading = false;
        this.tasksLoadError = '';
        if (this.selectedTaskId !== null && !tasks.some((task) => task.id === this.selectedTaskId)) {
          this.selectedTaskId = null;
        }
      },
      error: (error: unknown) => {
        console.error('Tasks im Navigationstree konnten nicht geladen werden:', error);
        this.tasksLoading = false;
        this.tasksLoadError = 'Tasks konnten nicht geladen werden.';
      },
    });
  }

  onTasksChanged(tasks: TaskDefinition[]): void {
    this.tasks = tasks;
    this.tasksLoading = false;
    this.tasksLoadError = '';
    if (this.selectedTaskId !== null && !tasks.some((task) => task.id === this.selectedTaskId)) {
      this.selectedTaskId = null;
    }
  }

  getTasksForCategory(categoryId: number): TaskDefinition[] {
    return this.tasks
      .filter((task) => task.category_id === categoryId)
      .sort((left, right) => left.title.localeCompare(right.title, 'de'));
  }

  refreshSavedHolidays(): void {
    this.calendarService.loadSavedHolidayData();
  }

  openDatabase(backupId: string | null = null): void {
    if (!this.isAdmin) return;
    this.editorActions = null;
    const shouldLoad = !this.expandedSections.database;
    this.activeTab = 'database';
    this.selectedDatabaseBackupId = backupId;
    this.expandedSections.database = true;
    if (backupId === null && shouldLoad) {
      this.apiService.getDatabaseTables().subscribe({
        next: (tables) => this.dbTables = tables,
        error: (error: unknown) => console.error('Datenbanktabellen konnten nicht geladen werden:', error),
      });
      this.refreshDatabaseBackups();
    }
  }

  openWeatherConfig(): void {
    if (!this.isAdmin) return;
    this.editorActions = null;
    const shouldLoad = !this.expandedSections.system;
    this.activeTab = 'system';
    this.expandedSections.system = true;
    this.selectedWeatherLocationId = null;
    if (shouldLoad) this.refreshWeatherLocations();
  }

  openWeatherLocation(locationId: number): void {
    if (!this.isAdmin) return;
    this.editorActions = null;
    this.expandedSections.system = true;
    this.activeTab = 'system';
    this.selectedWeatherLocationId = locationId;
  }

  refreshWeatherLocations(): void {
    this.weatherLocationsLoading = true;
    this.weatherLocationsError = '';
    this.apiService.getWeatherLocations().subscribe({
      next: (locations) => {
        this.weatherLocations = locations;
        this.weatherLocationsLoading = false;
        this.weatherLocationsError = '';
      },
      error: (error: unknown) => {
        console.error('Wetterstandorte im Navigationstree konnten nicht geladen werden:', error);
        this.weatherLocationsLoading = false;
        this.weatherLocationsError = 'Wetterstandorte konnten nicht geladen werden.';
      },
    });
  }

  onWeatherLocationsChanged(locations: WeatherLocation[]): void {
    this.weatherLocations = locations;
    this.weatherLocationsLoading = false;
    this.weatherLocationsError = '';
    if (this.selectedWeatherLocationId !== null
      && !locations.some((location) => location.id === this.selectedWeatherLocationId)) {
      this.selectedWeatherLocationId = locations.find((location) => location.is_active)?.id ?? null;
    }
  }

  onWeatherLocationSelected(locationId: number): void {
    this.selectedWeatherLocationId = locationId;
  }

  onEditorActionsChanged(actions: AdminEditorActions): void {
    this.editorActions = actions;
  }

  saveEditorChanges(): void {
    if (!this.editorActions || (!this.editorActions.dirty && !this.editorActions.showSave) || this.editorActions.busy) return;
    this.editorMessage = '';
    this.editorActions.save();
  }

  cancelEditorChanges(): void {
    if (!this.editorActions?.dirty || this.editorActions.busy) return;
    this.editorMessage = '';
    this.editorActions.cancel();
  }

  deleteEditorItem(): void {
    if (!this.editorActions?.canDelete || this.editorActions.busy) return;
    this.editorActions.delete?.();
  }

  refreshDatabaseBackups(): void {
    this.databaseBackupsLoading = true;
    this.databaseBackupsError = '';
    this.apiService.getDatabaseBackups().subscribe({
      next: (result) => this.onDatabaseBackupsChanged(result),
      error: (error: unknown) => {
        console.error('Datenbankbackups im Navigationstree konnten nicht geladen werden:', error);
        this.databaseBackupsLoading = false;
        this.databaseBackupsError = 'Backups konnten nicht geladen werden.';
      },
    });
  }

  onDatabaseBackupsChanged(result: DatabaseBackupList): void {
    this.databaseBackups = result.backups;
    this.databaseBackupErrors = result.errors;
    this.databaseBackupsLoading = false;
    this.databaseBackupsError = '';
  }

  databaseBackupLabel(backup: DatabaseBackup): string {
    const date = new Date(backup.created_at);
    if (Number.isNaN(date.getTime())) return backup.id;
    return `${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date)} · ${backup.id.slice(-6)}`;
  }

  onHolidayStateAdded(data: HolidayStateData): void {
    this.expandedSections.holidays = true;
    this.savedHolidayStates = [...new Set([...this.savedHolidayStates, data.state_code])].sort();
    this.savedHolidays = [
      ...this.savedHolidays.filter((holiday) => holiday.state_code !== data.state_code),
      ...data.holidays,
    ];
    this.selectedHolidayState = data.state_code;
    this.calendarService.setSavedHolidayData({
      states: this.savedHolidayStates,
      holidays: this.savedHolidays,
    });
  }

  onSavedHolidayDataChanged(data: { states: string[]; holidays: Holiday[] }): void {
    this.savedHolidayStates = data.states;
    this.savedHolidays = data.holidays;
    this.calendarService.setSavedHolidayData(data);
    if (this.selectedHolidayState && !data.states.includes(this.selectedHolidayState)) {
      this.selectedHolidayState = null;
    }
  }

  holidayStateName(code: string): string {
    return GERMAN_STATES.find((state) => state.code === code)?.name ?? code;
  }

  selectMembers(): void {
    this.editorActions = null;
    this.activeTab = 'users';
    this.selectedMemberId = null;
  }

  selectAccounts(): void {
    if (!this.isAdmin) return;
    this.editorActions = null;
    this.activeTab = 'accounts';
  }

  selectMember(userId: number): void {
    this.editorActions = null;
    this.activeTab = 'users';
    this.selectedMemberId = userId;
  }
}
