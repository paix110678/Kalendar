import { Component, Input, Output, EventEmitter, OnDestroy, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService, TimeBlock, User } from '../../../../services/calendar.service';

@Component({
  selector: 'app-time-block-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './time-block.component.html',
  styleUrl: './time-block.component.css'
})
export class TimeBlockComponent implements OnDestroy {
  @Input() block!: TimeBlock;
  @Input() user!: User;

  @Output() blockClicked = new EventEmitter<TimeBlock>();

  @HostBinding('style.display') display = 'block';
  @HostBinding('style.position') position = 'absolute';
  @HostBinding('style.top') top = '0';
  @HostBinding('style.bottom') bottom = '0';
  @HostBinding('style.left') left = '0';
  @HostBinding('style.right') right = '0';

  private startY = 0;
  private startEndRow = 0;

  constructor(private calendarService: CalendarService) {}

  public getBlockColor(): string {
    return this.block.color || this.calendarService.getCategoryColor(this.block.type);
  }

  public onDragStart(event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', this.block.id.toString());
  }

  public onBlockClick(event: MouseEvent): void {
    // REPARIERT: Verhindert das Durchsickern an das Gitterbett und emittiert das korrekte Output-Event!
    event.stopPropagation();
    event.preventDefault();
    this.blockClicked.emit(this.block);
  }

  public deleteBlock(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (confirm('Zeitblock löschen?')) {
      this.calendarService.deleteTimeBlock(this.block.id).subscribe({
        next: () => {},
        error: (err: any) => console.error('❌ Fehler beim Loeschen:', err)
      });
    }
  }

  public startResize(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.startY = event.clientY;
    this.startEndRow = this.calendarService.timeToGridRow(this.block.end_time);
    
    window.addEventListener('mousemove', this.onResizeMove);
    window.addEventListener('mouseup', this.onResizeEnd);
  }

  private onResizeMove = (event: MouseEvent): void => {
    const rowDelta = Math.round((event.clientY - this.startY) / this.calendarService.ROW_HEIGHT_PIXELS);
    this.block.end_time = this.calendarService.gridRowToTime(
      Math.max(this.calendarService.timeToGridRow(this.block.start_time) + 1, this.startEndRow + rowDelta)
    );
  };

  private onResizeEnd = (): void => {
    this.calendarService.moveTimeBlock(this.block.id, {
      day_of_week: this.block.day_of_week,
      start_time: this.block.start_time,
      end_time: this.block.end_time,
      title: this.block.title,
      type: this.block.type,
      user_id: this.block.user_id
    }).subscribe({
      next: () => {},
      error: (err: any) => console.error('❌ Fehler beim Verschieben:', err)
    });
    
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup', this.onResizeEnd);
  };

  ngOnDestroy(): void {
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup', this.onResizeEnd);
  }
}
