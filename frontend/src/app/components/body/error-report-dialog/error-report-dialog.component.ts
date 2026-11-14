import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { TimeoutError, timeout } from 'rxjs';

@Component({
  selector: 'app-error-report-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './error-report-dialog.component.html',
  styleUrl: './error-report-dialog.component.css',
})
export class ErrorReportDialogComponent implements AfterViewInit, OnChanges {
  @Input() screenshotDataUrl: string | null = null;
  @Input() screenshotError = '';
  @Output() closed = new EventEmitter<void>();
  @ViewChild('screenshotCanvas') private screenshotCanvas?: ElementRef<HTMLCanvasElement>;

  description = '';
  includeScreenshot = false;
  sending = false;
  submitted = false;
  errorMessage = '';
  screenshotReady = false;
  private screenshotImage: HTMLImageElement | null = null;
  private isMasking = false;
  private lastMaskPoint: { x: number; y: number } | null = null;

  readonly diagnostics = this.collectDiagnostics();

  constructor(
    private readonly apiService: ApiService,
    private readonly toastService: ToastService,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly zone: NgZone,
  ) {}

  ngAfterViewInit(): void {
    this.loadScreenshot();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const screenshotChange = changes['screenshotDataUrl'];
    if (screenshotChange?.firstChange) {
      this.includeScreenshot = Boolean(screenshotChange.currentValue);
    } else if (screenshotChange) {
      this.loadScreenshot();
    }
  }

  private collectDiagnostics(): Record<string, string | number> {
    return {
      browser: navigator.userAgent,
      platform: navigator.platform || 'unbekannt',
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      route: window.location.pathname,
      viewport_width: document.documentElement.clientWidth || window.innerWidth,
      viewport_height: document.documentElement.clientHeight || window.innerHeight,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      device_pixel_ratio: window.devicePixelRatio,
      color_depth: window.screen.colorDepth,
    };
  }

  submit(): void {
    const description = this.description.trim();
    if (this.sending) return;
    if (description.length < 10) {
      this.errorMessage = 'Bitte beschreibe den Fehler mit mindestens 10 Zeichen.';
      this.toastService.show(false, this.errorMessage);
      return;
    }

    let screenshot: string | null = null;
    if (this.includeScreenshot) {
      if (!this.screenshotCanvas?.nativeElement || !this.screenshotReady) {
        this.errorMessage = 'Der Screenshot ist noch nicht bereit. Bitte warte kurz oder sende den Bericht ohne Bild.';
        this.toastService.show(false, this.errorMessage);
        return;
      }
      screenshot = this.screenshotCanvas.nativeElement.toDataURL('image/jpeg', 0.8);
    }

    this.sending = true;
    this.errorMessage = '';
    this.apiService.submitErrorReport({
      description,
      diagnostics: this.diagnostics,
      screenshot,
    }).pipe(timeout({ first: 15000 })).subscribe({
      next: () => {
        this.zone.run(() => {
          this.sending = false;
          this.submitted = true;
          this.changeDetector.detectChanges();
        });
      },
      error: (error: unknown) => {
        console.error('Fehlerbericht konnte nicht gespeichert werden:', error);
        this.zone.run(() => {
          this.sending = false;
          this.errorMessage = this.getSubmitErrorMessage(error);
          this.toastService.show(false, this.errorMessage);
          this.changeDetector.detectChanges();
        });
      },
    });
  }

  private getSubmitErrorMessage(error: unknown): string {
    if (error instanceof TimeoutError) {
      return 'Der Server antwortet nicht. Bitte prüfe, ob das Backend läuft, und versuche es erneut.';
    }
    if (error instanceof HttpErrorResponse) {
      const serverMessage =
        typeof error.error?.detail === 'string' ? error.error.detail : null;
      if (serverMessage) return serverMessage;
      if (error.status === 0) {
        return 'Der Server ist nicht erreichbar. Bitte starte das Backend neu und versuche es erneut.';
      }
      if (error.status === 404 || error.status === 405) {
        return 'Die Fehlerbericht-API ist noch nicht geladen. Bitte starte das Backend neu.';
      }
      if (error.status === 413) {
        return 'Der Bericht ist zu groß. Bitte sende ihn ohne Screenshot.';
      }
      if (error.status === 422) {
        return 'Die Berichtsdaten wurden abgelehnt. Bitte prüfe deine Beschreibung und versuche es erneut.';
      }
    }
    return 'Der Fehlerbericht konnte nicht gespeichert werden. Bitte versuche es erneut.';
  }

  close(): void {
    if (!this.sending) this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  startMask(event: PointerEvent): void {
    if (!this.screenshotCanvas || !this.screenshotReady) return;
    this.isMasking = true;
    this.screenshotCanvas.nativeElement.setPointerCapture(event.pointerId);
    this.lastMaskPoint = this.getMaskPoint(event);
    this.drawMask(this.lastMaskPoint);
  }

  continueMask(event: PointerEvent): void {
    if (!this.isMasking) return;
    const point = this.getMaskPoint(event);
    if (this.lastMaskPoint) this.drawMask(this.lastMaskPoint, point);
    this.lastMaskPoint = point;
  }

  stopMask(): void {
    this.isMasking = false;
    this.lastMaskPoint = null;
  }

  clearMasks(): void {
    this.drawScreenshot();
  }

  private loadScreenshot(): void {
    this.screenshotReady = false;
    this.screenshotImage = null;
    if (!this.screenshotDataUrl) return;

    const image = new Image();
    image.onload = () => {
      this.screenshotImage = image;
      this.drawScreenshot();
      this.changeDetector.markForCheck();
    };
    image.onerror = (error: string | Event) => {
      console.error('Screenshot-Vorschau konnte nicht geladen werden:', error);
      this.screenshotError = 'Die Screenshot-Vorschau konnte nicht geladen werden. Du kannst den Bericht ohne Bild senden.';
      this.changeDetector.markForCheck();
    };
    image.src = this.screenshotDataUrl;
  }

  private drawScreenshot(): void {
    const canvas = this.screenshotCanvas?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !this.screenshotImage) return;

    canvas.width = this.screenshotImage.naturalWidth;
    canvas.height = this.screenshotImage.naturalHeight;
    context.drawImage(this.screenshotImage, 0, 0);
    this.screenshotReady = true;
  }

  private getMaskPoint(event: PointerEvent): { x: number; y: number } {
    const canvas = this.screenshotCanvas?.nativeElement;
    if (!canvas) return { x: 0, y: 0 };

    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(
        0,
        Math.min(canvas.width, ((event.clientX - bounds.left) / bounds.width) * canvas.width),
      ),
      y: Math.max(
        0,
        Math.min(canvas.height, ((event.clientY - bounds.top) / bounds.height) * canvas.height),
      ),
    };
  }

  private drawMask(start: { x: number; y: number }, end?: { x: number; y: number }): void {
    const canvas = this.screenshotCanvas?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0) return;

    context.beginPath();
    context.strokeStyle = '#000000';
    context.fillStyle = '#000000';
    context.lineWidth = (16 / bounds.width) * canvas.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.moveTo(start.x, start.y);
    if (end) {
      context.lineTo(end.x, end.y);
    } else {
      context.lineTo(start.x + 0.01, start.y + 0.01);
    }
    context.stroke();
    if (!end) {
      context.beginPath();
      context.arc(start.x, start.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    }
  }
}
