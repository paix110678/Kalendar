import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import {
  DatabaseBackupList,
  Holiday,
  HolidayStateData,
  PlanDefinition,
  TaskDefinition,
  WeatherLocation,
} from '../../../../services/api.service';
import { Category, User } from '../../../../services/calendar.service';
import { AdminEditorActions } from '../action-footer/action-footer.component';
import { AccountTreeData } from './accounts/account-management.component';
import { AdminTab } from '../menu/admin-navigation.component';
import { UsersComponent } from './users/users.component';
import { AccountManagementComponent } from './accounts/account-management.component';
import { CategoriesComponent } from './categories/categories.component';
import { SystemComponent } from './weather/system.component';
import { DatabaseComponent } from './database/database.component';
import { PlansComponent } from './plans/plans.component';
import { HolidaysComponent } from './holidays/holidays.component';
import { TasksComponent } from './tasks/tasks.component';
import { DisplaySettingsComponent } from './display-settings/display-settings.component';
import { PlatformStatisticsComponent } from './platform-statistics/platform-statistics.component';

@Component({
  selector: 'app-config-main',
  standalone: true,
  imports: [
    CommonModule,
    UsersComponent,
    AccountManagementComponent,
    CategoriesComponent,
    SystemComponent,
    DatabaseComponent,
    PlansComponent,
    HolidaysComponent,
    TasksComponent,
    DisplaySettingsComponent,
    PlatformStatisticsComponent,
  ],
  templateUrl: './config-main.component.html',
  styleUrl: './config-main.component.css',
})
export class ConfigMainComponent {
  @Input() activeTab: AdminTab = 'users';
  @Input() isAdmin = false;
  @Input() isPlatformAdmin = false;
  @Input() activeUsers: User[] = [];
  @Input() selectedAccountItemId: string | null = null;
  @Input() selectedMemberId: number | null = null;
  @Input() savedPlans: PlanDefinition[] = [];
  @Input() selectedPlanId: number | null = null;
  @Input() plansLoading = false;
  @Input() plansLoadError = '';
  @Input() savedHolidayStates: string[] = [];
  @Input() savedHolidays: Holiday[] = [];
  @Input() selectedHolidayState: string | null = null;
  @Input() holidaysLoading = false;
  @Input() holidaysLoadError = '';
  @Input() dbTables: string[] = [];
  @Input() selectedDatabaseBackupId: string | null = null;
  @Input() selectedWeatherLocationId: number | null = null;
  @Input() calendarCategories: Category[] = [];
  @Input() selectedCategoryId: number | null = null;
  @Input() tasks: TaskDefinition[] = [];
  @Input() selectedTaskId: number | null = null;
  @Input() selectedTaskCategoryId: number | null = null;

  @Output() editorActionsChange = new EventEmitter<AdminEditorActions | null>();
  @Output() accountTreeDataChange = new EventEmitter<AccountTreeData>();
  @Output() accountTreeItemChange = new EventEmitter<string | null>();
  @Output() memberClosed = new EventEmitter<void>();
  @Output() plansChanged = new EventEmitter<PlanDefinition[]>();
  @Output() stateAdded = new EventEmitter<HolidayStateData>();
  @Output() savedHolidayDataChanged = new EventEmitter<{ states: string[]; holidays: Holiday[] }>();
  @Output() selectedHolidayStateChange = new EventEmitter<string | null>();
  @Output() selectedCategoryChange = new EventEmitter<number | null>();
  @Output() locationsChanged = new EventEmitter<WeatherLocation[]>();
  @Output() selectedLocationChanged = new EventEmitter<number | null>();
  @Output() tasksChanged = new EventEmitter<TaskDefinition[]>();
  @Output() selectedTaskIdChange = new EventEmitter<number | null>();
  @Output() selectedBackupIdChange = new EventEmitter<string | null>();
  @Output() backupsChanged = new EventEmitter<DatabaseBackupList>();

  @ViewChild(PlansComponent) private plansComponent?: PlansComponent;
  @ViewChild(SystemComponent) private systemComponent?: SystemComponent;

  resetPlanForm(): void {
    this.plansComponent?.resetForm();
  }

  selectWeatherLocation(locationId: number): void {
    this.systemComponent?.selectLocationFromTree(locationId);
  }

  openPlan(planId: number): void {
    this.plansComponent?.openPlan(planId);
  }
}
