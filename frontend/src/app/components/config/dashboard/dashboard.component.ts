import { Component, Input, Output, EventEmitter, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, GERMAN_STATES, HolidayStateData, PlanDefinition } from '../../../services/api.service';

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
export class DashboardComponent implements OnInit {
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
  public selectedHolidayState: string | null = null;
  public holidaysLoading = false;
  public holidaysLoadError = '';
  public dbTables: string[] = [];

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.apiService.getDatabaseTables().subscribe((tables: string[]) => {
      this.dbTables = tables;
    });
    this.refreshSavedPlans();
    this.refreshSavedHolidays();
  }

  openPlans(): void {
    this.activeTab = 'plans';
    this.selectedPlanId = null;
    this.plansComponent?.resetForm();
    setTimeout(() => {
      if (this.activeTab === 'plans') {
        this.plansComponent?.loadPlans();
      }
    }, 50);
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
    this.plansLoading = true;
    this.plansLoadError = '';
    this.apiService.getPlans().subscribe({
      next: (plans) => {
        this.savedPlans = plans;
        this.plansLoading = false;
      },
      error: () => {
        this.plansLoading = false;
        this.plansLoadError = 'Gespeicherte Pläne konnten nicht geladen werden.';
      },
    });
  }

  onPlansChanged(plans: PlanDefinition[]): void {
    this.savedPlans = plans;
    this.plansLoading = false;
    this.plansLoadError = '';
    if (this.selectedPlanId !== null && !plans.some((plan) => plan.id === this.selectedPlanId)) {
      this.selectedPlanId = null;
    }
  }

  openHolidays(stateCode: string | null = null): void {
    this.activeTab = 'holidays';
    this.selectedHolidayState = stateCode;
  }

  refreshSavedHolidays(): void {
    this.holidaysLoading = true;
    this.holidaysLoadError = '';
    this.apiService.getHolidayStates().subscribe({
      next: (states) => {
        this.savedHolidayStates = states;
        this.holidaysLoading = false;
      },
      error: () => {
        this.holidaysLoading = false;
        this.holidaysLoadError = 'Gespeicherte Bundesländer konnten nicht geladen werden.';
      },
    });
  }

  onHolidayStateAdded(data: HolidayStateData): void {
    this.savedHolidayStates = [...new Set([...this.savedHolidayStates, data.state_code])].sort();
    this.selectedHolidayState = data.state_code;
    this.holidaysLoading = false;
    this.holidaysLoadError = '';
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
