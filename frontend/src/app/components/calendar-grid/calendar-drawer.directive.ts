import { Directive, ElementRef, HostListener, Input, Output, EventEmitter, inject } from '@angular/core';
import { CalendarService } from '../../services/calendar.service';

@Directive({
  selector: '[appCalendarDrawer]',
  standalone: true
})
export class CalendarDrawerDirective {
  @Input() day!: string;
  @Input() slotRow!: number;
  
  @Output() drawStarted = new EventEmitter<void>();
  @Output() drawEnded = new EventEmitter<void>();

  private calendarService = inject(CalendarService);

  private get isDrawing(): boolean { return (window as any).isCalendarDrawingNow || false; }
  private set isDrawing(val: boolean) { (window as any).isCalendarDrawingNow = val; }
  
  private get startRow(): number { return (window as any).calendarStartRow || 0; }
  private set startRow(val: number) { (window as any).calendarStartRow = val; }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; 
    
    const targetElement = event.target as HTMLElement;
    if (targetElement.closest('.time-block') || targetElement.closest('.btn-block-trash') || targetElement.closest('.resize-handle')) {
      return;
    }

    this.isDrawing = true;
    this.startRow = this.slotRow;

    const startTimeStr = this.calendarService.gridRowToTime(this.slotRow);
    const endTimeStr = this.calendarService.gridRowToTime(this.slotRow + 3);

    localStorage.setItem('DRAWN_DAY', this.day);
    localStorage.setItem('DRAWN_START_TIME', startTimeStr);
    localStorage.setItem('DRAWN_END_TIME', endTimeStr);
    
    // Falls dein Service Setter-Methoden anbietet, befüllen wir diese hier direkt reaktiv:
    if (typeof (this.calendarService as any).setDrawnStartTime === 'function') {
      (this.calendarService as any).setDrawnStartTime(startTimeStr);
      (this.calendarService as any).setDrawnEndTime(endTimeStr);
    }

    this.drawStarted.emit();
  }

  @HostListener('mouseenter')
  onMouseEnter(): void {
    if (!this.isDrawing) return;

    const actualStart = Math.min(this.startRow, this.slotRow);
    const actualEnd = Math.max(this.startRow, this.slotRow) + 1;

    const startTimeStr = this.calendarService.gridRowToTime(actualStart);
    const endTimeStr = this.calendarService.gridRowToTime(actualEnd);

    localStorage.setItem('DRAWN_START_TIME', startTimeStr);
    localStorage.setItem('DRAWN_END_TIME', endTimeStr);

    // Aktualisiert die Werte direkt im Service, um die Kette reaktiv zu triggern
    if (typeof (this.calendarService as any).setDrawnStartTime === 'function') {
      (this.calendarService as any).setDrawnStartTime(startTimeStr);
      (this.calendarService as any).setDrawnEndTime(endTimeStr);
    } else {
      // Sicherheits-Fallback: Falls keine Setter existieren, überschreiben wir die internen Felder direkt
      try { (this.calendarService as any).drawnStartTime = startTimeStr; } catch(e){}
      try { (this.calendarService as any).drawnEndTime = endTimeStr; } catch(e){}
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onGlobalMouseUp(event: MouseEvent): void {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.drawEnded.emit();
    }
  }
}
