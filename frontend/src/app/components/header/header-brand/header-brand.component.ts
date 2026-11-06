import { ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogoComponent } from '../logo/logo.component';
import { ErrorReportDialogComponent } from '../error-report-dialog/error-report-dialog.component';

@Component({
  selector: 'app-header-brand',
  standalone: true,
  imports: [CommonModule, LogoComponent, ErrorReportDialogComponent],
  templateUrl: './header-brand.component.html',
  styleUrl: './header-brand.component.css',
})
export class HeaderBrandComponent {
  @Input() showSettingsButton = true;
  @Output() adminPageOpened = new EventEmitter<void>();

  public showErrorReport = false;
  public isCapturingScreenshot = false;
  public screenshotDataUrl: string | null = null;
  public screenshotError = '';

  constructor(private readonly changeDetector: ChangeDetectorRef) {}

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
