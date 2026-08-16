import { Component, ViewEncapsulation } from '@angular/core';
import { CalendarHeaderComponent } from './header/calendar-header/calendar-header.component';
import { CalendarGridComponent } from './calendar-grid/calendar-grid.component';
import { BlockEditorComponent } from './block-editor/block-editor.component';
import { RewardDashboardComponent } from './reward-dashboard/reward-dashboard.component';
import { AdminDashboardComponent } from './admin-dashboard/admin-dashboard.component';

@Component({
  selector: 'app-calendar-shell',
  standalone: true,
  imports: [
    CalendarHeaderComponent,
    CalendarGridComponent,
    BlockEditorComponent,
    RewardDashboardComponent,
    AdminDashboardComponent
  ],
  templateUrl: './calendar-shell.component.html',
  styleUrl: './calendar-shell.component.css',
  encapsulation: ViewEncapsulation.None // HEBEL: Schaltet die Kapselung für das globale Layout aus
})
export class CalendarShellComponent {}
