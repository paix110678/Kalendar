import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarHeaderComponent } from './header/calendar-header/calendar-header.component';
import { CalendarGridComponent } from './main/calendar-grid/calendar-grid.component';
import { DashboardComponent } from './config/dashboard/dashboard.component';
import { RewardDashboardComponent } from './reward/reward-dashboard/reward-dashboard.component';

@Component({
  selector: 'app-calendar-shell',
  standalone: true,
  imports: [
    CommonModule,
    CalendarHeaderComponent,
    CalendarGridComponent,
    DashboardComponent,
    RewardDashboardComponent,
  ],
  templateUrl: './calendar-shell.component.html',
  styleUrls: [
    './calendar-shell.component.css',
    './calendar-shell.component.handy.css',
  ]
})
export class CalendarShellComponent {
  public showAdminPage = false;
}
