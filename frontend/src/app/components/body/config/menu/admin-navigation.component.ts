import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export type AdminTab =
  | 'users'
  | 'accounts'
  | 'plans'
  | 'holidays'
  | 'categories'
  | 'system'
  | 'database'
  | 'tasks'
  | 'display'
  | 'statistics';

export interface AdminNavigationAction {
  type:
    | 'members'
    | 'member'
    | 'accounts'
    | 'account'
    | 'invitation'
    | 'plans'
    | 'savedPlan'
    | 'holidays'
    | 'categories'
    | 'task'
    | 'weather'
    | 'weatherLocation'
    | 'database'
    | 'backup'
    | 'display'
    | 'statistics'
    | 'refreshPlans'
    | 'refreshHolidays'
    | 'refreshTasks'
    | 'refreshWeather'
    | 'refreshBackups';
  id?: number | string | null;
  categoryId?: number | null;
}

@Component({
  selector: 'app-admin-navigation',
  standalone: true,
  imports: [CommonModule  ],
  templateUrl: './admin-navigation.component.html',
  styleUrl: './admin-navigation.component.css',
})
export class AdminNavigationComponent {
  @Input() activeTab: AdminTab = 'users';
  @Input() isAdmin = false;
  @Input() isPlatformAdmin = false;

  @Output() action = new EventEmitter<AdminNavigationAction>();

  emit(type: AdminNavigationAction['type']): void {
    this.action.emit({ type });
  }
}
