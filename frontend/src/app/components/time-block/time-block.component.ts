import { Component, Input, Output, EventEmitter, OnDestroy, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService, TimeBlock, User } from '../../services/calendar.service';

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

  // WICHTIGE KORREKTUR: Zwingt den Browser dazu, das Grid-Start-Attribut direkt auf das äußere Tag anzuwenden!
  @HostBinding('style.grid-row-start') get rowStart(): number {
    return this.calendarService.timeToGridRow(this.block.start_time);
  }

  // WICHTIGE KORREKTUR: Zwingt den Browser dazu, das Grid-End-Attribut direkt auf das äußere Tag anzuwenden!
  @HostBinding('style.grid-row-end') get rowEnd(): number {
    return this.calendarService.timeToGridRow(this.block.end_time);
  }

  // Zwingt das Element, sich als absolute, ungestörte CSS-Kapsel im Grid-Track aufzuspannen
  @HostBinding('style.display') display = 'block';
  @HostBinding('style.position') position = 'relative';
  @HostBinding('style.grid-column') gridColumn = '1 / -1';

  private startY = 0;
  private startEndRow = 0;

  constructor(public calendarService: CalendarService) {}

  public onDragStart(event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', this.block.id.toString());
  }

  public onBlockClick(event: MouseEvent): void {
    event.stopPropagation();
    this.blockClicked.emit(this.block);
  }

  public deleteBlock(event: MouseEvent): void {
    event.stopPropagation();
    if (confirm('Zeitblock löschen?')) {
      this.calendarService.deleteTimeBlock(this.block.id, this.block.user_id).subscribe();
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
    this.calendarService.moveTimeBlock(
      this.block.id, 
      this.block.day_of_week, 
      this.block.start_time, 
      this.block.end_time
    ).subscribe();
    
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup', this.onResizeEnd);
  };

  ngOnDestroy(): void {
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup', this.onResizeEnd);
  }
}
