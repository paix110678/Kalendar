import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CalendarResource,
  CalendarEvent,
  GridCalendar,
  GridConfig,
  GridTheme,
  GridViewMode,
} from '@swbpapk_acmtemu/grid-calendar';
import { CalendarService, TimeBlock, User } from '../../../services/calendar.service';
import { BlockEditorComponent } from '../block-editor/block-editor.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-calendar-grid',
  standalone: true,
  imports: [
    CommonModule,
    GridCalendar,
    BlockEditorComponent,
  ],
  templateUrl: './calendar-grid.component.html',
  styleUrl: './calendar-grid.component.css'
})
export class CalendarGridComponent implements OnInit, OnDestroy {
  public calendarService = inject(CalendarService);
  private cdr = inject(ChangeDetectorRef);

  public activeUsersSignal = toSignal(this.calendarService.users$, { initialValue: [] as User[] });
  public currentBlocksSignal = toSignal(this.calendarService.blocks$, { initialValue: [] as TimeBlock[] });
  public activeRewardsSignal = toSignal(this.calendarService.rewards$, { initialValue: [] as any[] });
  public calendarEvents: CalendarEvent[] = [];
  public selectedUser: User | null = null;
  public showAdminPage = false;
  public showBlockEditor = false;
  public showRewardPage = false;
  public isEditingExisting = false;
  public currentViewMode: 'day' | '3days' | 'week' = 'day';
  public filteredDays: TimeBlock['day_of_week'][] = [];
  public hiddenUserIds: { [userId: number]: boolean } = {};
  public currentDayName!: TimeBlock['day_of_week'];
  public daysOfWeek: TimeBlock['day_of_week'][] = [
    'Montag',
    'Dienstag',
    'Mittwoch',
    'Donnerstag',
    'Freitag',
    'Samstag',
    'Sonntag',
  ];
  public currentEditingBlockId: number | null = null; 
  public readonly calendarConfig: GridConfig = {
    workingHoursStart: this.calendarService.START_HOUR,
    // Date treats hour 24 as 00:00, which would place the 24:00 label at the grid's start.
    workingHoursEnd: this.calendarService.END_HOUR - 1 / 60,
    pixelsPerHour: 60,
    gridLineIntervalMinutes: 5,
  };
  public readonly calendarTheme: GridTheme = {
    colorPrimary: '#212529',
    colorBackground: '#ffffff',
    colorBorder: '#212529',
    colorEventDefault: '#228be6',
    colorHourLine: '#495057',
    fontFamily: 'system-ui, sans-serif',
  };
  public readonly anchorDate = this.getTodayAtMidnight();
  private readonly blockSubscription = new Subscription();

  ngOnInit(): void {
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;
    this.currentDayName = this.getDayName(this.anchorDate);
    this.blockSubscription.add(
      this.calendarService.blocks$.subscribe(() => this.syncCalendarEvents()),
    );
    this.updateViewTimeline();
  }

  ngOnDestroy(): void {
    this.blockSubscription.unsubscribe();
  }

  public get calendarViewMode(): GridViewMode {
    return this.currentViewMode === '3days' ? '3day' : this.currentViewMode;
  }

  public get calendarResources(): CalendarResource[] {
    return this.getVisibleUsers().map((user) => ({
      id: user.id,
      name: user.name,
      color: user.color_code,
    }));
  }

  public changeViewMode(mode: 'day' | '3days' | 'week'): void {
    this.currentViewMode = mode;
    this.updateViewTimeline();
  }

  private updateViewTimeline(): void {
    const startIdx = this.daysOfWeek.indexOf(this.currentDayName);
    
    if (this.currentViewMode === 'day') {
      this.filteredDays = [this.currentDayName];
    } else if (this.currentViewMode === '3days') {
      this.filteredDays = [
        this.daysOfWeek[startIdx % 7], 
        this.daysOfWeek[(startIdx + 1) % 7], 
        this.daysOfWeek[(startIdx + 2) % 7]
      ];
    } else {
      const rotated: TimeBlock['day_of_week'][] = [];
      for (let i = 0; i < 7; i++) {
        rotated.push(this.daysOfWeek[(startIdx + i) % 7]);
      }
      this.filteredDays = rotated;
    }
    this.syncCalendarEvents();
    this.cdr.detectChanges();
  }

  public editExistingBlock(block: TimeBlock): void {
    this.isEditingExisting = true;
    const owner = this.activeUsersSignal().find(u => u.id === block.user_id);
    if (owner) {
      localStorage.setItem('EDITING_BLOCK_ID', block.id.toString());
      this.currentEditingBlockId = block.id; 
      this.selectedUser = owner;
      this.showBlockEditor = true;
      this.cdr.detectChanges();
    }
  }

  public onEditorSuccess(): void {
    this.showBlockEditor = false;
    this.isEditingExisting = false;
    this.currentEditingBlockId = null;
    this.calendarEvents = this.calendarEvents.filter((event) => event.id >= 0);
    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.removeItem('DRAWN_DAY');
    localStorage.removeItem('DRAWN_START_TIME');
    localStorage.removeItem('DRAWN_END_TIME');
    this.calendarService.loadInitialData();
    this.cdr.detectChanges();
  }

  public onEditorCancel(): void {
    this.showBlockEditor = false;
    this.isEditingExisting = false;
    this.currentEditingBlockId = null;
    this.calendarEvents = this.calendarEvents.filter((event) => event.id >= 0);
    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.removeItem('DRAWN_DAY');
    localStorage.removeItem('DRAWN_START_TIME');
    localStorage.removeItem('DRAWN_END_TIME');
    this.calendarService.loadAllBlocks();
    this.cdr.detectChanges();
  }

  public toggleUserVisibility(userId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.hiddenUserIds[userId] = !this.hiddenUserIds[userId];
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;
    this.syncCalendarEvents();
    this.cdr.detectChanges();
  }

  public isUserVisible(userId: number): boolean { 
    return !this.hiddenUserIds[userId]; 
  }

  public getVisibleUsers(): User[] { 
    return this.activeUsersSignal().filter(u => this.isUserVisible(u.id)); 
  }

  public openRewardDashboardForUser(user: User): void { 
    this.selectedUser = user; 
    this.showRewardPage = true; 
    this.cdr.detectChanges(); 
  }

  public onCalendarEventsChange(events: CalendarEvent[]): void {
    this.calendarEvents = events;
  }

  public onCalendarEventCreated(event: CalendarEvent): void {
    const user = this.activeUsersSignal().find((candidate) => candidate.id === event.resourceId);
    if (!user) {
      console.error(`Kalenderentwurf ${event.id} verweist auf keinen sichtbaren Benutzer.`);
      this.syncCalendarEvents();
      return;
    }

    const start = new Date(event.start);
    const end = new Date(event.end);
    if (!this.isValidDate(start) || !this.isValidDate(end)) {
      console.error(`Kalenderentwurf ${event.id} enthält eine ungültige Zeitspanne.`);
      this.syncCalendarEvents();
      return;
    }

    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.setItem('DRAWN_DAY', this.getDayName(start));
    localStorage.setItem('DRAWN_START_TIME', this.formatTime(start));
    localStorage.setItem('DRAWN_END_TIME', this.formatTime(end));
    this.currentEditingBlockId = null;
    this.isEditingExisting = false;
    this.selectedUser = user;
    this.showBlockEditor = true;
    this.cdr.detectChanges();
  }

  public onCalendarEventClicked(event: CalendarEvent): void {
    const block = this.findTimeBlockForEvent(event);
    if (block) {
      this.editExistingBlock(block);
    }
  }

  public onCalendarEventEdited(eventId: number): void {
    const event = this.calendarEvents.find((candidate) => candidate.id === eventId);
    if (event) {
      this.onCalendarEventClicked(event);
    }
  }

  public onCalendarEventDeleted(event: CalendarEvent): void {
    const block = this.findTimeBlockForEvent(event);
    if (!block) {
      console.error(`Kein Datenbank-Zeitblock für Kalendertermin ${event.id} gefunden.`);
      this.syncCalendarEvents();
      return;
    }
    if (!confirm('Zeitblock löschen?')) {
      this.syncCalendarEvents();
      return;
    }

    this.calendarService.deleteTimeBlock(block.id).subscribe({
      error: (error: unknown) => {
        console.error('Zeitblock konnte nicht gelöscht werden:', error);
        this.syncCalendarEvents();
      },
    });
  }

  public onCalendarEventMoved(event: CalendarEvent): void {
    this.persistCalendarEvent(event);
  }

  public onCalendarEventUpdated(event: CalendarEvent): void {
    this.persistCalendarEvent(event);
  }

  private syncCalendarEvents(): void {
    const visibleUserIds = new Set(this.getVisibleUsers().map((user) => user.id));
    const pendingDrafts = this.calendarEvents.filter((event) => event.id < 0);
    const events = this.currentBlocksSignal()
      .filter((block) => visibleUserIds.has(block.user_id))
      .flatMap((block) =>
        this.filteredDays
          .filter((day) => day === block.day_of_week)
          .map((day) => {
            const date = this.getDateForDay(day);
            const dayIndex = this.daysOfWeek.indexOf(day);
            const endCrossesMidnight = block.end_time === '00:00'
              && block.start_time !== '00:00';

            return {
              id: block.id * 10 + dayIndex,
              title: block.title,
              shortTitle: block.short_title,
              start: this.toCalendarDateTime(date, block.start_time),
              end: this.toCalendarDateTime(date, block.end_time, endCrossesMidnight),
              resourceId: block.user_id,
              category: block.type,
              color: this.calendarService.getCategoryColor(block.type),
              meta: { blockId: block.id },
            };
          }),
      );

    this.calendarEvents = [...events, ...pendingDrafts];
  }

  private persistCalendarEvent(event: CalendarEvent): void {
    const block = this.findTimeBlockForEvent(event);
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (!block || !this.isValidDate(start) || !this.isValidDate(end) || end <= start) {
      console.error(`Kalendertermin ${event.id} kann nicht gespeichert werden.`);
      this.syncCalendarEvents();
      return;
    }

    const userId = event.resourceId ?? block.user_id;
    const payload = {
      day_of_week: this.getDayName(start),
      start_time: this.formatTime(start),
      end_time: this.formatTime(end),
      title: block.title,
      short_title: block.short_title ?? null,
      type: block.type,
      user_id: userId,
    };

    this.calendarService.updateUserBlockOwner(block.id, userId).subscribe({
      next: () => {
        this.calendarService.moveTimeBlock(block.id, payload).subscribe({
          error: (error: unknown) => {
            console.error('Zeitblock konnte nicht verschoben werden:', error);
            this.calendarService.loadAllBlocks();
          },
        });
      },
      error: (error: unknown) => {
        console.error('Besitzer des Zeitblocks konnte nicht geändert werden:', error);
        this.calendarService.loadAllBlocks();
      },
    });
  }

  private findTimeBlockForEvent(event: CalendarEvent): TimeBlock | undefined {
    const blockId = event.meta?.['blockId'];
    const databaseId = typeof blockId === 'number' ? blockId : Math.floor(event.id / 10);
    return this.currentBlocksSignal().find((block) => block.id === databaseId);
  }

  private getDateForDay(day: TimeBlock['day_of_week']): Date {
    const date = new Date(this.anchorDate);
    const anchorDayIndex = this.daysOfWeek.indexOf(this.currentDayName);
    const targetDayIndex = this.daysOfWeek.indexOf(day);
    date.setDate(date.getDate() + ((targetDayIndex - anchorDayIndex + 7) % 7));
    return date;
  }

  private getTodayAtMidnight(): Date {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  private getDayName(date: Date): TimeBlock['day_of_week'] {
    return this.daysOfWeek[(date.getDay() + 6) % 7];
  }

  private toCalendarDateTime(date: Date, time: string, nextDay = false): string {
    const [hours, minutes] = time.split(':').map(Number);
    const dateTime = new Date(date);
    if (nextDay) {
      dateTime.setDate(dateTime.getDate() + 1);
    }
    dateTime.setHours(hours, minutes, 0, 0);
    return dateTime.toISOString();
  }

  private formatTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private isValidDate(date: Date): boolean {
    return !Number.isNaN(date.getTime());
  }
}
