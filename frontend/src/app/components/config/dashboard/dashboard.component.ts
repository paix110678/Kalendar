import { Component, Input, Output, EventEmitter, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, GERMAN_STATES, Holiday, HolidayStateData, PlanDefinition } from '../../../services/api.service';
import { CalendarService } from '../../../services/calendar.service';
import { Subscription } from 'rxjs';

// Importpfade matchen exakt zu euren neuen, sauberen Geschwister-Ordnern
import { UsersComponent } from '../users/users.component';
import { CategoriesComponent } from '../categories/categories.component';
import { SystemComponent } from '../weather/system.component';
import { DatabaseComponent } from '../database/database.component';
import { PlansComponent } from '../plans/plans.component';
import { HolidaysComponent } from '../holidays/holidays.component';
import { User } from '../../../services/calendar.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    UsersComponent, 
    CategoriesComponent, 
    SystemComponent, 
    DatabaseComponent,
    PlansComponent,
    HolidaysComponent
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

  public activeTab: 'users' | 'plans' | 'holidays' | 'categories' | 'system' | 'database' = 'users';
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
  private readonly subscriptions = new Subscription();

  constructor(private apiService: ApiService, private calendarService: CalendarService) {}

  ngOnInit(): void {
    this.apiService.getDatabaseTables().subscribe((tables: string[]) => {
      this.dbTables = tables;
    });
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
    this.activeTab = 'plans';
    this.selectedPlanId = null;
    this.plansComponent?.resetForm();
  }

  openSavedPlan(planId: number): void {
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
    this.activeTab = 'holidays';
    this.selectedHolidayState = stateCode;
  }

  refreshSavedHolidays(): void {
    this.calendarService.loadSavedHolidayData();
  }

  onHolidayStateAdded(data: HolidayStateData): void {
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

  holidayStateName(code: string): string {
    return GERMAN_STATES.find((state) => state.code === code)?.name ?? code;
  }

  selectMembers(): void {
    this.activeTab = 'users';
    this.selectedMemberId = null;
  }

  selectMember(userId: number): void {
    this.activeTab = 'users';
    this.selectedMemberId = userId;
  }
}
