import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User, TimeBlock } from '../../services/calendar.service';

@Component({
  standalone: true,
  selector: 'app-block-editor',
  imports: [CommonModule, FormsModule],
  templateUrl: './block-editor.component.html',
  styleUrl: './block-editor.component.css'
})
export class BlockEditorComponent implements OnInit, OnChanges {
  @Input() selectedUser: User | null = null;
  @Input() activeUsers: User[] = [];

  @Output() blockSaved = new EventEmitter<void>();
  @Output() closeEditor = new EventEmitter<void>();

  // Formular-Variablen
  public blockTitle = '';
  public blockType: 'duty' | 'media' | 'school' | 'sport' | 'patchwork_garden' | 'family' = 'duty';
  public targetUserId: number = 0;
  public startTime = '09:00';
  public endTime = '10:00';
  public currentDay = 'Montag';

  // ID des Blocks, falls wir einen bestehenden bearbeiten
  public editingBlockId: number | null = null;

  // Kategorien mit deinen originalen Kalender-Farben
  public categories = [
    { value: 'duty', label: 'Pflicht (Duty)', color: '#fa5252' },
    { value: 'media', label: 'Medienzeit', color: '#be4bdb' },
    { value: 'school', label: 'Schule / Hausaufgaben', color: '#fd7e14' },
    { value: 'sport', label: 'Sport / Verein', color: '#40c057' },
    { value: 'patchwork_garden', label: 'Garten / Patchwork', color: '#fab005' },
    { value: 'family', label: 'Familienzeit', color: '#15aabf' }
  ];

  constructor(private calendarService: CalendarService) {}

  ngOnInit(): void {
    this.syncEditorData();
  }

  // REAKTIVER HEBEL: Aktualisiert das Formular sofort im Hintergrund, wenn du einen neuen Entwurf ziehst!
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedUser'] && !changes['selectedUser'].firstChange) {
      this.syncEditorData();
    }
  }

  // Ausgelagerte Core-Logik zur sauberen Formularbefüllung
  private syncEditorData(): void {
    const savedBlockId = localStorage.getItem('EDITING_BLOCK_ID');
    
    if (savedBlockId) {
      this.editingBlockId = Number(savedBlockId);
      this.calendarService.blocks$.subscribe((blocks: TimeBlock[]) => {
        const currentBlock = blocks.find(b => b.id === this.editingBlockId);
        if (currentBlock) {
          this.blockTitle = currentBlock.title;
          this.blockType = currentBlock.type;
          this.targetUserId = currentBlock.user_id;
          this.startTime = currentBlock.start_time;
          this.endTime = currentBlock.end_time;
          this.currentDay = currentBlock.day_of_week;

          localStorage.setItem('DRAWN_START_TIME', this.startTime);
          localStorage.setItem('DRAWN_END_TIME', this.endTime);
        }
      });
    } else {
      // Modus: Neuer Entwurf vom Grid gezogen (Aktualisiert die Live-Werte)
      this.currentDay = this.calendarService.getDrawnDay();
      this.startTime = this.calendarService.getDrawnStartTime();
      this.endTime = this.calendarService.getDrawnEndTime();
      if (this.selectedUser) {
        this.targetUserId = this.selectedUser.id;
      }
    }
  }

  public onTimeChange(): void {
    localStorage.setItem('DRAWN_START_TIME', this.startTime);
    localStorage.setItem('DRAWN_END_TIME', this.endTime);
    
    if (this.editingBlockId) {
      this.calendarService.blocks$.subscribe((blocks: TimeBlock[]) => {
        const currentBlock = blocks.find(b => b.id === this.editingBlockId);
        if (currentBlock) {
          currentBlock.start_time = this.startTime;
          currentBlock.end_time = this.endTime;
          currentBlock.user_id = Number(this.targetUserId);
          currentBlock.type = this.blockType;
        }
      });
    }

    this.calendarService.loadAllBlocks();
  }

  public saveBlock(): void {
    if (!this.blockTitle.trim()) {
      alert('Bitte einen Titel eingeben!');
      return;
    }

    if (this.editingBlockId) {
      this.calendarService.updateUserBlockOwner(this.editingBlockId, Number(this.targetUserId)).subscribe(() => {
        this.calendarService.moveTimeBlock(this.editingBlockId!, this.currentDay, this.startTime, this.endTime).subscribe({
          next: () => this.blockSaved.emit(),
          error: (err) => console.error('❌ Fehler beim Ändern des Blocks:', err)
        });
      });
    } else {
      const newBlock: Omit<TimeBlock, 'id' | 'is_locked'> = {
        user_id: Number(this.targetUserId),
        title: this.blockTitle,
        day_of_week: this.currentDay as any,
        start_time: this.startTime,
        end_time: this.endTime,
        type: this.blockType
      };

      this.calendarService.addTimeBlock(newBlock).subscribe({
        next: () => this.blockSaved.emit(),
        error: (err) => console.error('❌ Fehler beim Erstellen des Blocks:', err)
      });
    }
  }
}
