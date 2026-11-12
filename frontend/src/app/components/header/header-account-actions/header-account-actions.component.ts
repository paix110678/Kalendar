import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../services/auth.service';
import { CalendarService } from '../../../services/calendar.service';
import { KALENDAR_VERSION } from '../../../version';
import { ErrorReportDialogComponent } from '../error-report-dialog/error-report-dialog.component';

@Component({
  selector: 'app-header-account-actions',
  standalone: true,
  imports: [CommonModule, ErrorReportDialogComponent],
  templateUrl: './header-account-actions.component.html',
  styleUrls: [
    './header-account-actions.component.css',
    './header-account-actions.component.handy.css',
  ],
})
export class HeaderAccountActionsComponent {
  private readonly changeDetector = inject(ChangeDetectorRef);
  public readonly authService = inject(AuthService);
  private readonly calendarService = inject(CalendarService);
  private readonly users = toSignal(this.calendarService.users$, { initialValue: [] });

  @Output() adminPageOpened = new EventEmitter<void>();

  readonly version = KALENDAR_VERSION;
  public showAccountDetails = false;
  public showErrorReport = false;
  public isCapturingScreenshot = false;
  public screenshotDataUrl: string | null = null;
  public screenshotError = '';
  public logoutError = '';

  get canOpenAdmin(): boolean {
    const account = this.authService.currentAccount;
    return ['admin', 'adult'].includes(account?.role ?? '') || account?.is_platform_admin === true;
  }

  get accountInitials(): string {
    const name = this.authService.currentAccount?.display_name.trim() ?? '';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toLocaleUpperCase();
  }

  get accountColor(): string {
    const account = this.authService.currentAccount;
    return this.users().find((user) => user.id === account?.profile_id)?.color_code ?? '#4c6ef5';
  }

  get accountRoleLabel(): string {
    const role = this.authService.currentAccount?.role;
    return role ? {
      admin: 'Administrator',
      adult: 'Erwachsene Person',
      teen: 'Jugendliche Person',
      child: 'Kind',
      guest: 'Gast',
    }[role] : '';
  }

  logout(): void {
    this.logoutError = '';
    this.authService.logout().subscribe({
      error: (error: unknown) => {
        this.logoutError = error instanceof HttpErrorResponse
          ? error.error?.detail ?? 'Abmeldung fehlgeschlagen.'
          : 'Abmeldung fehlgeschlagen.';
      },
    });
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
