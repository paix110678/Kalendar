import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogoComponent } from '../logo/logo.component';
import { ErrorReportDialogComponent } from '../error-report-dialog/error-report-dialog.component';
import { AuthService } from '../../../services/auth.service';
import { KALENDAR_VERSION } from '../../../version';

@Component({
  selector: 'app-header-brand',
  standalone: true,
  imports: [CommonModule, LogoComponent, ErrorReportDialogComponent],
  templateUrl: './header-brand.component.html',
  styleUrl: './header-brand.component.css',
})
export class HeaderBrandComponent {
  readonly version = KALENDAR_VERSION;
  @Output() adminPageOpened = new EventEmitter<void>();

  public showErrorReport = false;
  public isCapturingScreenshot = false;
  public screenshotDataUrl: string | null = null;
  public screenshotError = '';
  public logoutError = '';

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    readonly authService: AuthService,
  ) {}

  get canOpenAdmin(): boolean {
    const account = this.authService.currentAccount;
    return ['admin', 'adult'].includes(account?.role ?? '') || account?.is_platform_admin === true;
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
