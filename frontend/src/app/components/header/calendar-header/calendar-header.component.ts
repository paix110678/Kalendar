import { ChangeDetectorRef, Component, OnInit, OnDestroy, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User, SystemConfig } from '../../../services/calendar.service';
import { WeatherWidgetComponent } from '../weather-widget/weather-widget.component';
import { UserSelectorComponent } from '../user-selector/user-selector.component';
import { ViewModeButtonsComponent } from '../view-mode-buttons/view-mode-buttons.component'; 
import { LogoComponent } from '../logo/logo.component'; // KORREKTUR: Logo-Import hinzugefügt
import { ErrorReportDialogComponent } from '../error-report-dialog/error-report-dialog.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-calendar-header',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    WeatherWidgetComponent, 
    UserSelectorComponent, 
    ViewModeButtonsComponent,
    LogoComponent,
    ErrorReportDialogComponent
  ],
  templateUrl: './calendar-header.component.html',
  styleUrl: './calendar-header.component.css'
})
export class CalendarHeaderComponent implements OnInit, OnDestroy {
  @Input() activeUsers: User[] = [];
  @Input() currentViewMode: 'day' | '3days' | 'week' = 'day';
  
  @Output() viewModeChanged = new EventEmitter<'day' | '3days' | 'week'>();
  @Output() userVisibilityToggled = new EventEmitter<{userId: number, event: MouseEvent}>();
  @Output() rewardDashboardOpened = new EventEmitter<User>();
  @Output() adminPageOpened = new EventEmitter<void>();

  public sysConfig: SystemConfig | null = null;
  public showErrorReport = false;
  public isCapturingScreenshot = false;
  public screenshotDataUrl: string | null = null;
  public screenshotError = '';
  private sub = new Subscription();

  constructor(
    private calendarService: CalendarService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.sub.add(this.calendarService.config$.subscribe(c => {
      if (c) this.sysConfig = c;
    }));
  }

  public isUserVisible(userId: number): boolean {
    return !((window as any).hiddenUserIdsCache?.[userId]);
  }

  public handleUsersReordered(newOrder: User[]): void {
    if (this.calendarService && typeof this.calendarService.updateUsersOrder === 'function') {
      this.calendarService.updateUsersOrder(newOrder);
    } else {
      this.activeUsers = newOrder;
    }
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

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
