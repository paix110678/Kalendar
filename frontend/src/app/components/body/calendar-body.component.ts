import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ErrorReportDialogComponent } from './error-report-dialog/error-report-dialog.component';

@Component({
  selector: 'app-calendar-body',
  standalone: true,
  imports: [ErrorReportDialogComponent],
  template: `
    @if (showErrorReport) {
      @defer (on immediate) {
        <app-error-report-dialog
          [screenshotDataUrl]="screenshotDataUrl"
          [screenshotError]="screenshotError"
          (closed)="errorReportClosed.emit()">
        </app-error-report-dialog>
      } @loading {
        <div role="status">Fehlerbericht wird geöffnet …</div>
      } @error {
        <div role="alert">Der Fehlerbericht konnte nicht geöffnet werden.</div>
      }
    } @else {
      <ng-content></ng-content>
    }
  `,
  styleUrl: './calendar-body.component.css',
})
export class CalendarBodyComponent {
  @Input() showErrorReport = false;
  @Input() screenshotDataUrl: string | null = null;
  @Input() screenshotError = '';
  @Output() errorReportClosed = new EventEmitter<void>();
}
