import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarHeaderComponent } from './header/calendar-header/calendar-header.component';
import { CalendarGridComponent } from './main/calendar-grid/calendar-grid.component';
import { DashboardComponent } from './config/dashboard/dashboard.component';
import { RewardDashboardComponent } from './reward/reward-dashboard/reward-dashboard.component';
import { AuthComponent } from './auth/auth.component';
import { AuthService } from '../services/auth.service';
import { ErrorReportDialogComponent } from './header/error-report-dialog/error-report-dialog.component';

@Component({
  selector: 'app-calendar-shell',
  standalone: true,
  imports: [
    CommonModule,
    CalendarHeaderComponent,
    CalendarGridComponent,
    DashboardComponent,
    RewardDashboardComponent,
    AuthComponent,
    ErrorReportDialogComponent,
  ],
  templateUrl: './calendar-shell.component.html',
  styleUrls: [
    './calendar-shell.component.css',
    './calendar-shell.component.handy.css',
  ]
})
export class CalendarShellComponent {
  public readonly authService = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  public readonly authState$ = this.authService.state$;
  public showAdminPage = false;
  public showErrorReport = false;
  public isCapturingScreenshot = false;
  public screenshotDataUrl: string | null = null;
  public screenshotError = '';

  public openAdminPage(): void {
    this.showAdminPage = true;
  }

  public async openErrorReport(): Promise<void> {
    if (this.isCapturingScreenshot || this.showErrorReport) return;

    this.isCapturingScreenshot = true;
    this.screenshotDataUrl = null;
    this.screenshotError = '';
    this.changeDetector.detectChanges();

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#ffffff',
        foreignObjectRendering: true,
        height: window.innerHeight,
        logging: false,
        scale: Math.min(1, 1600 / window.innerWidth),
        useCORS: true,
        width: window.innerWidth,
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        onclone: (clonedDocument) => {
          clonedDocument.querySelector('.screenshot-capture-overlay')?.remove();
        },
      });
      this.screenshotDataUrl = canvas.toDataURL('image/jpeg', 0.8);
    } catch (error) {
      console.error('Screenshot für Fehlerbericht konnte nicht erstellt werden:', error);
      this.screenshotError = 'Der Screenshot konnte nicht erstellt werden. Du kannst den Bericht trotzdem ohne Bild senden.';
    } finally {
      this.isCapturingScreenshot = false;
      this.showErrorReport = true;
      this.changeDetector.detectChanges();
    }
  }
}
