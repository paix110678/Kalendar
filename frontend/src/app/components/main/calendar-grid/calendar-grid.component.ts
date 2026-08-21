import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarDrawerDirective } from '../calendar-grid/calendar-drawer.directive'; 
import { CalendarService, TimeBlock, User } from '../../../services/calendar.service';
import { TimeBlockComponent } from '../time-block/time-block.component'; 
import { PreviewDraftComponent } from '../preview-draft/preview-draft.component'; 
import { BlockEditorComponent } from '../block-editor/block-editor.component';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-calendar-grid',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    CalendarDrawerDirective,
    TimeBlockComponent, 
    PreviewDraftComponent,
    BlockEditorComponent
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
  public currentDayName!: string;
  public daysOfWeek = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  public timeSlots: string[] = [];
  public currentBlackLineRow = 1;
  public currentBlackTimeStr = '06:00';
  public currentEditingBlockId: number | null = null; 
  private updateIntervalId: any = null;

  ngOnInit(): void {
    this.timeSlots = [];
    const slotsCount = ((this.calendarService.END_HOUR - this.calendarService.START_HOUR) * 60) / 5;
    
    for (let slot = 0; slot <= slotsCount; slot++) {
      if (slot === slotsCount) {
        this.timeSlots.push('00:00');
      } else {
        this.timeSlots.push(this.calendarService.gridRowToTime(slot + 1));
      }
    }
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;

    const dateObj = new Date();
    const daysEnToDe: { [key: string]: string } = { 'Monday': 'Montag', 'Tuesday': 'Dienstag', 'Wednesday': 'Mittwoch', 'Thursday': 'Donnerstag', 'Friday': 'Freitag', 'Saturday': 'Samstag', 'Sunday': 'Sonntag' };
    this.currentDayName = daysEnToDe[dateObj.toLocaleDateString('en-US', { weekday: 'long' })] || 'Donnerstag';

    this.updateViewTimeline();
    this.calculateLiveGridRow();

    this.updateIntervalId = setInterval(() => {
      this.calculateLiveGridRow();
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
    }
  }

  private calculateLiveGridRow(): void {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    this.currentBlackTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    if (hours < this.calendarService.START_HOUR) {
      this.currentBlackLineRow = 1;
      return;
    }
    if (hours >= this.calendarService.END_HOUR && minutes > 0) {
      this.currentBlackLineRow = 217;
      return;
    }

    const totalMinutesSinceStart = (hours - this.calendarService.START_HOUR) * 60 + minutes;
    this.currentBlackLineRow = Math.floor(totalMinutesSinceStart / 5) + 1;
  }

  public getFormattedDateWithKW(dayName: string): string {
    const today = new Date();
    const currentDayIdx = today.getDay() === 0 ? 6 : today.getDay() - 1; 
    const targetDayIdx = this.daysOfWeek.indexOf(dayName);   
    const diff = targetDayIdx - currentDayIdx;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + diff);
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

    return `(${dd}.${mm}. / KW ${weekNo})`;
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
      const rotated: string[] = [];
      for (let i = 0; i < 7; i++) {
        rotated.push(this.daysOfWeek[(startIdx + i) % 7]);
      }
      this.filteredDays = rotated;
    }
    this.cdr.detectChanges();
  }

  public onDrawingStarted(user: User): void {
    localStorage.removeItem('EDITING_BLOCK_ID');
    this.currentEditingBlockId = null;
    this.isEditingExisting = false;
    this.isDrawingLive = true; 
    this.lastDrawnUserId = user.id;
    this.selectedUser = user;
    this.cdr.detectChanges();
  }

  public onDrawingFinished(): void {
    this.isDrawingLive = false; 
    this.showBlockEditor = true;
    this.cdr.detectChanges();
  }

  public editExistingBlock(block: TimeBlock): void {
    this.isEditingExisting = true;
    this.isDrawingLive = false;
    const owner = this.activeUsersSignal().find(u => u.id === block.user_id);
    if (owner) {
      localStorage.setItem('EDITING_BLOCK_ID', block.id.toString());
      this.currentEditingBlockId = block.id; 
      this.selectedUser = owner;
      this.lastDrawnUserId = owner.id;
      this.showBlockEditor = true;
      this.cdr.detectChanges();
    }
  }

  public onEditorSuccess(): void {
    this.showBlockEditor = false;
    this.isEditingExisting = false;
    this.isDrawingLive = false;
    this.currentEditingBlockId = null;
    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.removeItem('DRAWN_START_TIME');
    localStorage.removeItem('DRAWN_END_TIME');
    this.calendarService.loadInitialData();
    this.cdr.detectChanges();
  }

  public onEditorCancel(): void {
    this.showBlockEditor = false;
    this.isEditingExisting = false;
    this.isDrawingLive = false;
    this.currentEditingBlockId = null;
    localStorage.removeItem('EDITING_BLOCK_ID');
    localStorage.removeItem('DRAWN_START_TIME');
    localStorage.removeItem('DRAWN_END_TIME');
    this.calendarService.loadAllBlocks();
    this.cdr.detectChanges();
  }

  public toggleUserVisibility(userId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.hiddenUserIds[userId] = !this.hiddenUserIds[userId];
    (window as any).hiddenUserIdsCache = this.hiddenUserIds;
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

  public onDrop(event: DragEvent, targetDay: string, targetRow: number, userId: number): void {
    event.preventDefault();
    const rawId = event.dataTransfer?.getData('text/plain');
    
    if (!rawId || isNaN(Number(rawId))) return;

    const id = Number(rawId);
    const b = this.currentBlocksSignal().find(x => x.id === id);
    if (b) {
      const start = this.calendarService.gridRowToTime(targetRow);
      const end = this.calendarService.gridRowToTime(targetRow + this.calendarService.durationToGridRows(b.start_time, b.end_time));
      
      this.calendarService.updateUserBlockOwner(id, userId).subscribe(() => {
        const movedPayload = {
          day_of_week: targetDay as any,
          start_time: start,
          end_time: end,
          title: b.title,
          short_title: b.short_title || null,
          type: b.type,
          user_id: userId
        };
        this.calendarService.moveTimeBlock(id, movedPayload).subscribe(() => {
          this.cdr.detectChanges();
        });
      });
    }
  }
}
