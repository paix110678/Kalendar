import { Component, OnInit, OnDestroy, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User, SystemConfig } from '../../../services/calendar.service';
import { WeatherWidgetComponent } from '../weather-widget/weather-widget.component';
import { UserSelectorComponent } from '../user-selector/user-selector.component';
import { ViewModeButtonsComponent } from '../view-mode-buttons/view-mode-buttons.component'; 
import { LogoComponent } from '../logo/logo.component'; // KORREKTUR: Logo-Import hinzugefügt
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-calendar-header',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    WeatherWidgetComponent, 
    UserSelectorComponent, 
    ViewModeButtonsComponent,
    LogoComponent // KORREKTUR: Registriert das neue Sub-Modul
  ],
  templateUrl: './calendar-header.component.html',
  styleUrl: './calendar-header.component.css'
})
export class CalendarHeaderComponent implements OnInit, OnDestroy {
  @Input() activeUsers: User[] = [];
  @Input() currentViewMode: 'day' | '3days' | 'week' = 'day';
  
  @Output() viewModeChanged = new EventEmitter<'day' | '3days' | 'week'>();
  @Output() userVisibilityToggled = new EventEmitter<{userId: number, event: MouseEvent}>();
  @Output() rewardDashboardOpened = new EventEmitter<User>();
  @Output() adminPageOpened = new EventEmitter<void>();

  public sysConfig: SystemConfig | null = null;
  private sub = new Subscription();

  constructor(private calendarService: CalendarService) {}

  ngOnInit(): void {
    this.sub.add(this.calendarService.config$.subscribe(c => {
      if (c) this.sysConfig = c;
    }));
  }

  public isUserVisible(userId: number): boolean {
    return !((window as any).hiddenUserIdsCache?.[userId]);
  }

  public handleUsersReordered(newOrder: User[]): void {
    if (this.calendarService && typeof this.calendarService.updateUsersOrder === 'function') {
      this.calendarService.updateUsersOrder(newOrder);
    } else {
      this.activeUsers = newOrder;
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
