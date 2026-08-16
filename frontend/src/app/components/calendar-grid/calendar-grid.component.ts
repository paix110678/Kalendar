import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarDrawerDirective } from './calendar-drawer.directive'; 
import { CalendarService, TimeBlock, User } from '../../services/calendar.service';
import { LiveTimeTravelerComponent } from '../live-time-traveler/live-time-traveler.component';
import { TimeBlockComponent } from '../time-block/time-block.component'; 
import { PreviewDraftComponent } from '../preview-draft/preview-draft.component'; 
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-calendar-grid',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    CalendarDrawerDirective,
    LiveTimeTravelerComponent, 
    TimeBlockComponent, 
    PreviewDraftComponent
  ],
  templateUrl: './calendar-grid.component.html',
  styleUrl: './calendar-grid.component.css'
})
export class CalendarGridComponent implements OnInit {
  public calendarService = inject(CalendarService);

  public activeUsersSignal = toSignal(this.calendarService.users$, { initialValue: [] as User[] });
  public currentBlocksSignal = toSignal(this.calendarService.blocks$, { initialValue: [] as TimeBlock[] });
  public activeRewardsSignal = toSignal(this.calendarService.rewards$, { initialValue: [] as any[] });
  
  public selectedUser: User | null = null;
  public showAdminPage = false;
  public showBlockEditor = false;
  public showRewardPage = false;
  public lastDrawnUserId = 0;
  public isEditingExisting = false;
  public isDrawingLive = false;

  public currentViewMode: 'day' | '3days' | 'week' = 'day';
  public filteredDays: string[] = [];
  public hiddenUserIds: { [userId: number]: boolean } = {};
  public currentDayName = 'Donnerstag';

  public daysOfWeek = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  public timeSlots: string[] = [];

  ngOnInit(): void {
    const slotsCount = ((this.calendarService.END_HOUR - this.calendarService.START_HOUR) * 60) / 5;
    for (let slot = 0; slot < slotsCount; slot++) {
      this.timeSlots.push(this.calendarService.gridRowToTime(slot + 1));
    }
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;

    const dateObj = new Date();
    const daysEnToDe: { [key: string]: string } = { 'Monday': 'Montag', 'Tuesday': 'Dienstag', 'Wednesday': 'Mittwoch', 'Thursday': 'Donnerstag', 'Friday': 'Freitag', 'Saturday': 'Samstag', 'Sunday': 'Sonntag' };
    this.currentDayName = daysEnToDe[dateObj.toLocaleDateString('en-US', { weekday: 'long' })] || 'Donnerstag';

    this.updateViewTimeline();
  }

  public changeViewMode(mode: 'day' | '3days' | 'week'): void {
    this.currentViewMode = mode;
    this.updateViewTimeline();
  }

  // KORREKTUR: Rotiert das 7-Tage-Array so, dass "Heute" immer an erster Stelle ganz links beginnt
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
      // Modus: 'week' -> Baut alle 7 Tage reaktiv ab dem aktuellen Wochentag auf
      const rotated: string[] = [];
      for (let i = 0; i < 7; i++) {
        rotated.push(this.daysOfWeek[(startIdx + i) % 7]);
      }
      this.filteredDays = rotated;
    }
  }

  public onDrawingStarted(user: User): void {
    localStorage.removeItem('EDITING_BLOCK_ID');
    this.isEditingExisting = false;
    this.isDrawingLive = true; 
    this.lastDrawnUserId = user.id;
    this.selectedUser = user;
  }

  public onDrawingFinished(): void {
    this.isDrawingLive = false; 
    this.showBlockEditor = true; 
  }

  public editExistingBlock(block: TimeBlock): void {
    this.isEditingExisting = true;
    this.isDrawingLive = false;
    const owner = this.activeUsersSignal().find(u => u.id === block.user_id);
    if (owner) {
      localStorage.setItem('EDITING_BLOCK_ID', block.id.toString());
      this.selectedUser = owner;
      this.lastDrawnUserId = owner.id;
      this.showBlockEditor = true;
    }
  }

  public onEditorSuccess(): void {
    this.showBlockEditor = false;
    this.isEditingExisting = false;
    this.isDrawingLive = false;
    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.removeItem('DRAWN_START_TIME');
    localStorage.removeItem('DRAWN_END_TIME');
    this.calendarService.loadInitialData();
  }

  public onEditorCancel(): void {
    this.showBlockEditor = false;
    this.isEditingExisting = false;
    this.isDrawingLive = false;
    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.removeItem('DRAWN_START_TIME');
    localStorage.removeItem('DRAWN_END_TIME');
    this.calendarService.loadAllBlocks();
  }

  public toggleUserVisibility(userId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.hiddenUserIds[userId] = !this.hiddenUserIds[userId];
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;
  }

  public isUserVisible(userId: number): boolean { return !this.hiddenUserIds[userId]; }
  public getVisibleUsers(): User[] { return this.activeUsersSignal().filter(u => this.isUserVisible(u.id)); }
  public openRewardDashboardForUser(user: User): void { this.selectedUser = user; this.showRewardPage = true; }

  public onDrop(event: DragEvent, targetDay: string, targetRow: number, userId: number): void {
    event.preventDefault();
    const rawId = event.dataTransfer?.getData('text/plain');
    
    if (!rawId || isNaN(Number(rawId))) return;

    const id = Number(rawId);
    const b = this.currentBlocksSignal().find(x => x.id === id);
    if (b) {
      const start = this.calendarService.gridRowToTime(targetRow);
      const end = this.calendarService.gridRowToTime(targetRow + this.calendarService.durationToGridRows(b.start_time, b.end_time));
      this.calendarService.updateUserBlockOwner(id, userId);
      this.calendarService.moveTimeBlock(id, targetDay, start, end).subscribe();
    }
  }
}
