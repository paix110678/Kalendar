import { Component, OnInit, OnDestroy, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService, User, SystemConfig } from '../../../services/calendar.service';
import { HeaderPreferences } from '../../../services/api.service';
import { HeaderControlsComponent } from '../header-controls/header-controls.component';
import { HeaderBrandComponent } from '../header-brand/header-brand.component';
import { TitleBackHeaderComponent } from '../../shared/title-back-header/title-back-header.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-calendar-header',
  standalone: true,
  imports: [
    CommonModule,
    HeaderControlsComponent,
    HeaderBrandComponent,
    TitleBackHeaderComponent
  ],
  templateUrl: './calendar-header.component.html',
  styleUrl: './calendar-header.component.css'
})
export class CalendarHeaderComponent implements OnInit, OnDestroy {
  @Input() activeUsers: User[] = [];
  @Input() currentViewMode: 'day' | '3days' | 'week' = 'day';
  @Input() headerTitle: string | null = null;
  
  @Output() viewModeChanged = new EventEmitter<'day' | '3days' | 'week'>();
  @Output() userVisibilityToggled = new EventEmitter<{userId: number, event: MouseEvent}>();
  @Output() rewardDashboardOpened = new EventEmitter<User>();
  @Output() adminPageOpened = new EventEmitter<void>();
  @Output() headerBack = new EventEmitter<void>();

  public sysConfig: SystemConfig | null = null;
  public headerPreferences: HeaderPreferences = {
    show_users: true,
    show_view_mode: true,
    show_weather: true,
  };
  private sub = new Subscription();

  constructor(private calendarService: CalendarService) {}

  ngOnInit(): void {
    this.sub.add(this.calendarService.config$.subscribe(c => {
      if (c) this.sysConfig = c;
    }));
    this.sub.add(this.calendarService.headerPreferences$.subscribe(preferences => {
      this.headerPreferences = preferences;
    }));
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
