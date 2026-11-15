import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AccountProfileComponent } from './account-profile/account-profile.component';
import { ErrorReportDialogComponent } from './error-report-dialog/error-report-dialog.component';

@Component({
  selector: 'app-calendar-body',
  standalone: true,
  imports: [AccountProfileComponent, ErrorReportDialogComponent],
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
      <div class="body-content" [class.body-content-hidden]="showAccountProfile">
        <ng-content></ng-content>
      </div>
      @if (showAccountProfile) {
        @defer (on immediate) {
          <app-account-profile (closed)="accountProfileClosed.emit()"></app-account-profile>
        } @loading {
          <div role="status">Kontodetails werden geladen …</div>
        } @error {
          <div role="alert">Die Kontodetails konnten nicht geladen werden.</div>
        }
      }
    }
  `,
  styleUrl: './calendar-body.component.css',
})
export class CalendarBodyComponent {
  @Input() showErrorReport = false;
  @Input() showAccountProfile = false;
  @Input() screenshotDataUrl: string | null = null;
  @Input() screenshotError = '';
  @Output() errorReportClosed = new EventEmitter<void>();
  @Output() accountProfileClosed = new EventEmitter<void>();
}
