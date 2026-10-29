import { Component, Input, Output, EventEmitter, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';

// Importpfade matchen exakt zu euren neuen, sauberen Geschwister-Ordnern
import { UsersComponent } from '../users/users.component';
import { CategoriesComponent } from '../categories/categories.component';
import { SystemComponent } from '../weather/system.component';
import { DatabaseComponent } from '../database/database.component';
import { PlansComponent } from '../plans/plans.component';

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
    PlansComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  @Input() activeUsers: any[] = [];
  @Input() activeRewards: any[] = [];
  
  // REPARIERT: Stellt das vom Shell-Template gesuchte Eingangsfeld fehlerfrei wieder her!
  @Input() selectedUser: any = null;
  
  @Output() closeAdmin = new EventEmitter<void>();

  @ViewChild(PlansComponent) private plansComponent?: PlansComponent;

  public activeTab: 'users' | 'plans' | 'categories' | 'system' | 'database' = 'users';
  public dbTables: string[] = [];

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.apiService.getDatabaseTables().subscribe((tables: string[]) => {
      this.dbTables = tables;
    });
  }

  openPlans(): void {
    this.activeTab = 'plans';
    setTimeout(() => {
      if (this.activeTab === 'plans') {
        this.plansComponent?.loadPlans();
      }
    }, 50);
  }
}
