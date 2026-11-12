import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeaderPreferences } from '../../../services/api.service';
import { SystemConfig, User } from '../../../services/calendar.service';
import { UserSelectorComponent } from '../user-selector/user-selector.component';
import { ViewModeButtonsComponent } from '../view-mode-buttons/view-mode-buttons.component';
import { WeatherWidgetComponent } from '../weather-widget/weather-widget.component';

@Component({
  selector: 'app-header-controls',
  standalone: true,
  imports: [
    CommonModule,
    UserSelectorComponent,
    ViewModeButtonsComponent,
    WeatherWidgetComponent,
  ],
  templateUrl: './header-controls.component.html',
  styleUrls: [
    './header-controls.component.css',
    './header-controls.component.handy.css',
  ],
})
export class HeaderControlsComponent {
  @Input() activeUsers: User[] = [];
  @Input() currentViewMode: 'day' | '3days' | 'week' = 'day';
  @Input() config: SystemConfig | null = null;
  @Input() preferences: HeaderPreferences = {
    show_users: true,
    show_view_mode: true,
    show_weather: true,
  };

  @Output() viewModeChanged = new EventEmitter<'day' | '3days' | 'week'>();
  @Output() userVisibilityToggled = new EventEmitter<{ userId: number; event: MouseEvent }>();
  @Output() rewardDashboardOpened = new EventEmitter<User>();
}
