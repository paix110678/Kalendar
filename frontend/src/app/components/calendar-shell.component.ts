import { ChangeDetectorRef, Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarHeaderComponent } from './header/calendar-header/calendar-header.component';
import { CalendarBodyComponent } from './body/calendar-body.component';
import { CalendarGridComponent } from './body/calendar/calendar-grid/calendar-grid.component';
import { ConfigComponent } from './body/config/config.component';
import { RewardDashboardComponent } from './body/rewards/reward-dashboard/reward-dashboard.component';
import { AuthComponent } from './body/auth/auth.component';
import { AuthService } from '../services/auth.service';
import { GlobalToastComponent } from './shared/global-toast/global-toast.component';

@Component({
  selector: 'app-calendar-shell',
  standalone: true,
  imports: [
    CommonModule,
    CalendarHeaderComponent,
    CalendarBodyComponent,
    CalendarGridComponent,
    ConfigComponent,
    RewardDashboardComponent,
    AuthComponent,
    GlobalToastComponent,
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
  public authHeaderTitle = 'Anmeldung';
  public authHeaderShowBack = false;
  @ViewChild(AuthComponent) public authComponent?: AuthComponent;
  public showAdminPage = false;
  public showErrorReport = false;
  public isCapturingScreenshot = false;
  public screenshotDataUrl: string | null = null;
  public screenshotError = '';

  public openAdminPage(): void {
    this.showAdminPage = true;
  }

  public setAuthHeader(state: { title: string; showBack: boolean }): void {
    this.authHeaderTitle = state.title;
    this.authHeaderShowBack = state.showBack;
  }

  public onAuthHeaderBack(): void {
    this.authComponent?.setMode('login');
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
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const html2canvas = (await import('html2canvas/dist/html2canvas.esm.js')).default;
      const canvas = await html2canvas(document.documentElement, {
        backgroundColor: '#ffffff',
        height: viewportHeight,
        logging: false,
        scale: Math.min(1, 1600 / viewportWidth),
        useCORS: true,
        width: viewportWidth,
        windowHeight: viewportHeight,
        windowWidth: viewportWidth,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        onclone: (clonedDocument) => {
          clonedDocument.querySelector('.screenshot-capture-overlay')?.remove();
          this.normalizeUnsupportedColors(clonedDocument);
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

  // html2canvas 1.x kann moderne CSS-Farbfunktionen nicht parsen; nur der Klon wird deshalb nach RGBA umgewandelt.
  private normalizeUnsupportedColors(clonedDocument: Document): void {
    const clonedWindow = clonedDocument.defaultView;
    const context = clonedDocument.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!clonedWindow || !context) {
      throw new Error('Farbumwandlung für Screenshot nicht verfügbar.');
    }

    const colorFunction = /\b(?:oklch|oklab|lch|lab)\([^()]*\)/gi;
    for (const element of Array.from(clonedDocument.querySelectorAll<HTMLElement | SVGElement>('*'))) {
      const computedStyle = clonedWindow.getComputedStyle(element);
      for (let index = 0; index < computedStyle.length; index += 1) {
        const property = computedStyle.item(index);
        const value = computedStyle.getPropertyValue(property);
        if (!colorFunction.test(value)) continue;

        colorFunction.lastIndex = 0;
        const normalizedValue = value.replace(colorFunction, (color) => {
          if (!clonedWindow.CSS.supports('color', color)) {
            throw new Error(`Nicht unterstützte CSS-Farbe: ${color}`);
          }
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
          return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
        });
        element.style.setProperty(property, normalizedValue, 'important');
      }
    }
  }
}
