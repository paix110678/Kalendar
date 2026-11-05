import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CalendarResource,
  CalendarEvent,
  DayAnnotation,
  GridCalendar,
  GridConfig,
  GridLabels,
  GridTheme,
  GridViewMode,
  VisibleRange,
} from '@swbpapk_acmtemu/grid-calendar';
import { PlanDefinition } from '../../../services/api.service';
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
  private readonly savedPlansSignal = toSignal(this.calendarService.savedPlansState$, {
    initialValue: { data: null, loading: false, error: null },
  });
  private readonly savedHolidayDataSignal = toSignal(this.calendarService.savedHolidayDataState$, {
    initialValue: { data: null, loading: false, error: null },
  });
  public readonly calendarDayAnnotations = computed(() => {
    const holidays = this.savedHolidayDataSignal().data?.holidays ?? [];
    const dates = this.visibleDates().map((date) => this.toDateKey(date));
    const resourceIds = this.visibleUserIds();
    const usersById = new Map(this.activeUsersSignal().map((user) => [user.id, user]));
    const annotationsByPersonAndDate = new Map<string, DayAnnotation>();

    for (const holiday of holidays) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.start_date) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(holiday.end_date) ||
          holiday.end_date < holiday.start_date) {
        console.error('Ungültiger Ferien- oder Feiertagszeitraum:', holiday);
        continue;
      }

      const type = holiday.holiday_type === 'school' ? 'vacation' : 'holiday';
      for (const date of dates) {
        if (date < holiday.start_date || date > holiday.end_date) continue;
        for (const resourceId of resourceIds) {
          if (usersById.get(resourceId)?.state_code !== holiday.state_code) continue;
          const key = `${resourceId}:${date}:${type}`;
          const current = annotationsByPersonAndDate.get(key);
          if (!current || holiday.name.localeCompare(current.label) < 0) {
            annotationsByPersonAndDate.set(key, {
              date,
              resourceId,
              type,
              label: holiday.name,
            });
          }
        }
      }
    }

    return [...annotationsByPersonAndDate.values()].sort((left, right) =>
      left.date.localeCompare(right.date)
      || left.resourceId - right.resourceId
      || (left.type === right.type ? 0 : left.type === 'vacation' ? -1 : 1),
    );
  });
  public calendarEvents: CalendarEvent[] = [];
  public selectedUser: User | null = null;
  public showAdminPage = false;
  public showBlockEditor = false;
  public showRewardPage = false;
  public isEditingExisting = false;
  public currentViewMode: 'day' | '3days' | 'week' = 'day';
  public readonly visibleDates = signal<Date[]>([]);
  private readonly visibleUserIds = signal<number[]>([]);
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
  public readonly calendarLabels: Partial<GridLabels> = {
    today: 'Heute',
    previous: 'Vorheriger Zeitraum',
    next: 'Nächster Zeitraum',
  };
  public readonly anchorDate = this.getTodayAtMidnight();
  private visibleAnchorDate = new Date(this.anchorDate);
  private readonly blockSubscription = new Subscription();

  ngOnInit(): void {
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;
    this.currentDayName = this.getDayName(this.visibleAnchorDate);
    this.blockSubscription.add(
      this.calendarService.blocks$.subscribe(() => this.syncCalendarEvents()),
    );
    this.blockSubscription.add(
      this.calendarService.users$.subscribe(() => {
        this.updateVisibleUserIds();
        this.syncCalendarEvents();
      }),
    );
    this.blockSubscription.add(
      this.calendarService.savedPlansState$.subscribe(() => this.syncCalendarEvents()),
    );
    this.blockSubscription.add(
      this.calendarService.savedHolidayDataState$.subscribe(() => this.syncCalendarEvents()),
    );
    this.updateVisibleUserIds();
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

  public onVisibleRangeChange(range: VisibleRange): void {
    if (!this.isValidDate(range.from) || !this.isValidDate(range.to) || range.to < range.from) {
      console.error('Der Kalender hat einen ungültigen sichtbaren Zeitraum gemeldet:', range);
      return;
    }

    this.visibleAnchorDate = new Date(
      range.from.getFullYear(),
      range.from.getMonth(),
      range.from.getDate(),
    );
    this.currentDayName = this.getDayName(this.visibleAnchorDate);
    this.updateViewTimeline();
  }

  private updateViewTimeline(): void {
    const visibleDayCount = this.currentViewMode === 'day'
      ? 1
      : this.currentViewMode === '3days'
        ? 3
        : 7;
    this.visibleDates.set(Array.from({ length: visibleDayCount }, (_, index) => {
      const date = new Date(this.visibleAnchorDate);
      date.setDate(date.getDate() + index);
      return date;
    }));
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
    this.updateVisibleUserIds();
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
    if (block && !this.isBlockReadOnly(block)) {
      this.editExistingBlock(block);
    }
  }

  public onCalendarEventEdited(eventId: number): void {
    const event = this.calendarEvents.find((candidate) => candidate.id === eventId);
    if (event && !event.locked) {
      this.onCalendarEventClicked(event);
    }
  }

  public onCalendarEventDeleted(event: CalendarEvent): void {
    const block = this.findTimeBlockForEvent(event);
    if (block && this.isBlockReadOnly(block)) {
      this.syncCalendarEvents();
      return;
    }
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
    const usersById = new Map(this.activeUsersSignal().map((user) => [user.id, user]));
    const plansById = new Map(
      (this.savedPlansSignal().data ?? []).map((plan: PlanDefinition) => [plan.id, plan]),
    );
    const holidays = this.savedHolidayDataSignal().data?.holidays ?? [];
    const pendingDrafts = this.calendarEvents.filter((event) => event.id < 0);
    const events = this.currentBlocksSignal()
      .filter((block) => visibleUserIds.has(block.user_id) && block.is_visible !== false)
      .flatMap((block) =>
        this.visibleDates()
          .filter((date) =>
            this.getDayName(date) === block.day_of_week
            && !this.isExcludedPlanDate(block, date, usersById, plansById, holidays),
          )
          .map((date) => {
            const dayIndex = this.daysOfWeek.indexOf(this.getDayName(date));
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
              color: block.color || this.calendarService.getCategoryColor(block.type),
              locked: this.isBlockReadOnly(block),
              meta: { blockId: block.id },
            };
          }),
      );

    this.calendarEvents = [...events, ...pendingDrafts];
  }

  private isExcludedPlanDate(
    block: TimeBlock,
    date: Date,
    usersById: Map<number, User>,
    plansById: Map<number, PlanDefinition>,
    holidays: Array<{ state_code: string; holiday_type: 'school' | 'public'; start_date: string; end_date: string }>,
  ): boolean {
    if (block.plan_assignment_id == null) return false;
    const user = usersById.get(block.user_id);
    const plan = user?.assigned_plan_id == null ? undefined : plansById.get(user.assigned_plan_id);
    if (!user?.state_code || !plan) return false;

    const dateKey = this.toDateKey(date);
    return holidays.some((holiday) =>
      holiday.state_code === user.state_code
      && dateKey >= holiday.start_date
      && dateKey <= holiday.end_date
      && (
        (holiday.holiday_type === 'school' && plan.exclude_school_holidays)
        || (holiday.holiday_type === 'public' && plan.exclude_public_holidays)
      ),
    );
  }

  private updateVisibleUserIds(): void {
    this.visibleUserIds.set(this.getVisibleUsers().map((user) => user.id));
  }

  private persistCalendarEvent(event: CalendarEvent): void {
    const block = this.findTimeBlockForEvent(event);
    if (block && this.isBlockReadOnly(block)) {
      this.syncCalendarEvents();
      return;
    }
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

  private isBlockReadOnly(block: TimeBlock): boolean {
    return block.is_locked || block.plan_assignment_id != null;
  }

  private getTodayAtMidnight(): Date {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
