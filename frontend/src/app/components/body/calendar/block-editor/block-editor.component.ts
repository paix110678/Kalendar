import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User, TimeBlock, Category } from '../../../../services/calendar.service';
import { Subscription, take } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-block-editor',
  imports: [CommonModule, FormsModule],
  templateUrl: './block-editor.component.html',
  styleUrls: [
    './block-editor.component.css',
    './block-editor.component.handy.css',
  ]
})
export class BlockEditorComponent implements OnInit, OnChanges, OnDestroy {
  @Input() selectedUser: User | null = null;
  @Input() activeUsers: User[] = [];
  @Input() editingBlockId: number | null = null;

  @Output() blockSaved = new EventEmitter<void>();
  @Output() closeEditor = new EventEmitter<void>();

  public blockTitle = '';
  public blockShortTitle = ''; 
  public blockType: string = ''; 
  public targetUserId: number = 0;
  public startTime = '09:00';
  public endTime = '10:00';
  public currentDay = 'Montag';

  public categories: Category[] = [];
  public isDropdownOpen = false; // REPARIERT: Steuert den Aufklapp-Zustand des Custom-Dropdowns
  private readonly categorySubscription = new Subscription();

  constructor(public calendarService: CalendarService) {}

  ngOnInit(): void {
    this.categorySubscription.add(this.calendarService.categories$.subscribe((cats: Category[]) => {
      this.categories = cats;
    }));
    this.syncEditorData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['selectedUser'] && !changes['selectedUser'].firstChange) || 
        (changes['editingBlockId'] && !changes['editingBlockId'].firstChange)) {
      this.syncEditorData();
    }
  }

  private syncEditorData(): void {
    const currentId = this.editingBlockId !== null ? this.editingBlockId : (localStorage.getItem('EDITING_BLOCK_ID') ? Number(localStorage.getItem('EDITING_BLOCK_ID')) : null);
    
    if (currentId !== null) {
      this.calendarService.blocks$.pipe(take(1)).subscribe((blocks: TimeBlock[]) => {
        const currentBlock = blocks.find(b => b.id === currentId);
        if (currentBlock) {
          this.blockTitle = currentBlock.title;
          this.blockShortTitle = currentBlock.short_title || ''; 
          this.blockType = currentBlock.type;
          this.targetUserId = currentBlock.user_id;
          this.startTime = currentBlock.start_time;
          this.endTime = currentBlock.end_time;
          this.currentDay = currentBlock.day_of_week;

          localStorage.setItem('DRAWN_START_TIME', this.startTime);
          localStorage.setItem('DRAWN_END_TIME', this.endTime);
          this.calendarService.setDrawnCategory(this.blockType); 
        }
      });
    } else {
      this.currentDay = this.calendarService.getDrawnDay();
      this.startTime = this.calendarService.getDrawnStartTime();
      this.endTime = this.calendarService.getDrawnEndTime();
      this.blockTitle = '';
      this.blockShortTitle = ''; 
      this.blockType = ''; 
      this.calendarService.setDrawnCategory('preview_blue');
      if (this.selectedUser) {
        this.targetUserId = this.selectedUser.id;
      }
    }
  }

  // REPARIERT: Hilfsmethode, um die aktuell ausgewählte Kategorie für den geschlossenen Zustand zu ermitteln
  public getSelectedCategoryLabel(): string {
    const found = this.categories.find(c => c.value === this.blockType);
    return found ? found.label : 'Kategorie wählen...';
  }

  public getSelectedCategoryColor(): string {
    const found = this.categories.find(c => c.value === this.blockType);
    return found ? found.color : 'transparent';
  }

  public isFormValid(): boolean {
    return this.blockTitle.trim().length > 0 && 
           this.blockShortTitle.trim().length > 0 && 
           this.blockType !== '';
  }

  public cancelAndReset(): void {
    this.blockTitle = '';
    this.blockShortTitle = '';
    this.blockType = '';
    this.isDropdownOpen = false;
    this.calendarService.setDrawnCategory('preview_blue');
    this.closeEditor.emit();
  }

  public onTimeChange(): void {
    localStorage.setItem('DRAWN_START_TIME', this.startTime);
    localStorage.setItem('DRAWN_END_TIME', this.endTime);
    
    if (this.blockType) {
      this.calendarService.setDrawnCategory(this.blockType);
    }

    const currentId = this.editingBlockId !== null ? this.editingBlockId : (localStorage.getItem('EDITING_BLOCK_ID') ? Number(localStorage.getItem('EDITING_BLOCK_ID')) : null);
    if (currentId !== null) {
      this.calendarService.updateBlockLivePreview(currentId, {
        start_time: this.startTime,
        end_time: this.endTime,
        user_id: Number(this.targetUserId),
        type: this.blockType, 
        title: this.blockTitle,
        short_title: this.blockShortTitle
      });
    }
  }

  public selectCategory(value: string): void {
    this.blockType = value;
    this.isDropdownOpen = false; // Schließt die Liste nach der Auswahl reaktiv
    this.onTimeChange();
  }

  public saveBlock(): void {
    if (!this.isFormValid()) {
      return;
    }

    const currentId = this.editingBlockId !== null ? this.editingBlockId : (localStorage.getItem('EDITING_BLOCK_ID') ? Number(localStorage.getItem('EDITING_BLOCK_ID')) : null);

    if (currentId !== null) {
      this.calendarService.updateUserBlockOwner(currentId, Number(this.targetUserId)).subscribe(() => {
        const updatePayload = {
          day_of_week: this.currentDay,
          start_time: this.startTime,
          end_time: this.endTime,
          title: this.blockTitle,
          short_title: this.blockShortTitle.trim(),
          type: this.blockType,
          user_id: Number(this.targetUserId)
        };

        this.calendarService.moveTimeBlock(currentId, updatePayload).subscribe({
          next: () => {
            this.calendarService.setDrawnCategory('preview_blue');
            this.blockSaved.emit();
          },
          error: (err: any) => console.error('❌ Fehler beim Ändern des Blocks:', err)
        });
      });
    } else {
      const newBlock = {
        user_id: Number(this.targetUserId),
        title: this.blockTitle,
        short_title: this.blockShortTitle.trim(), 
        day_of_week: this.currentDay,
        start_time: this.startTime,
        end_time: this.endTime,
        type: this.blockType
      };

      this.calendarService.addTimeBlock(newBlock).subscribe({
        next: () => {
          this.calendarService.setDrawnCategory('preview_blue');
          this.blockSaved.emit();
        },
        error: (err: any) => console.error('❌ Fehler beim Erstellen des Blocks:', err)
      });
    }
  }

  ngOnDestroy(): void {
    this.categorySubscription.unsubscribe();
    this.calendarService.setDrawnCategory('preview_blue');
  }
}
