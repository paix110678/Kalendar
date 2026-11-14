import { Component, HostBinding, inject, ChangeDetectorRef, DoCheck } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService } from '../../../../services/calendar.service';

@Component({
  selector: 'app-preview-draft',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preview-draft.component.html',
  styleUrl: './preview-draft.component.css'
})
export class PreviewDraftComponent implements DoCheck {
  public calendarService = inject(CalendarService);
  private cdr = inject(ChangeDetectorRef);

  @HostBinding('style.grid-row-start') get rowStart(): number {
    return this.calendarService.timeToGridRow(this.calendarService.getDrawnStartTime());
  }

  @HostBinding('style.grid-row-end') get rowEnd(): number {
    return this.calendarService.timeToGridRow(this.calendarService.getDrawnEndTime());
  }

  // REPARIERT: Holt den Typen absolut sicher und synchron direkt aus der getDrawnCategory-Brücke des Services
  public getCategoryColor(): string {
    const currentCat = this.calendarService.getDrawnCategory();
    if (currentCat === 'preview_blue') return '#1c7ed6'; // Ursprüngliches Standard-Blau beim Zeichnen
    return this.calendarService.getCategoryColor(currentCat);
  }

  @HostBinding('style.display') display = 'block';
  @HostBinding('style.position') position = 'absolute'; 
  @HostBinding('style.left') left = '0';                 
  @HostBinding('style.right') right = '0';               
  @HostBinding('style.grid-column') gridColumn = '1 / -1';
  @HostBinding('style.pointer-events') pointerEvents = 'none';

  ngDoCheck(): void {
    this.cdr.markForCheck(); 
  }
}
