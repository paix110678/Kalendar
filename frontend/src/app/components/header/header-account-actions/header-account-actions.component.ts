import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../services/auth.service';
import { CalendarService } from '../../../services/calendar.service';
import { ApiService, WeatherLocation } from '../../../services/api.service';
import { KALENDAR_VERSION } from '../../../version';

@Component({
  selector: 'app-header-account-actions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './header-account-actions.component.html',
  styleUrls: [
    './header-account-actions.component.css',
    './header-account-actions.component.handy.css',
  ],
})
export class HeaderAccountActionsComponent {
  public readonly authService = inject(AuthService);
  private readonly calendarService = inject(CalendarService);
  private readonly users = toSignal(this.calendarService.users$, { initialValue: [] });

  @Input() isCapturingScreenshot = false;
  @Output() adminPageOpened = new EventEmitter<void>();
  @Output() errorReportRequested = new EventEmitter<void>();

  readonly version = KALENDAR_VERSION;
  public showAccountDetails = false;
  public logoutError = '';
  public weatherLocations: WeatherLocation[] = [];
  public selectedWeatherLocationId: number | null = null;
  public weatherLocationLoading = false;
  public weatherLocationError = '';

  toggleAccountDetails(): void {
    this.showAccountDetails = !this.showAccountDetails;
    if (this.showAccountDetails) this.loadWeatherProfile();
  }

  private loadWeatherProfile(): void {
    this.weatherLocationLoading = true;
    this.weatherLocationError = '';
    this.calendarService.refreshProfileWeather().subscribe({
      next: (profileWeather) => {
        this.weatherLocations = profileWeather.locations;
        this.selectedWeatherLocationId = profileWeather.selected_location_id;
        this.weatherLocationLoading = false;
      },
      error: () => {
        this.weatherLocationLoading = false;
        this.weatherLocationError = 'Wetterstandorte konnten nicht geladen werden.';
      },
    });
  }

  onWeatherLocationChange(locationId: number | string): void {
    const parsedId = Number(locationId);
    if (!Number.isInteger(parsedId) || parsedId < 1) return;
    this.weatherLocationLoading = true;
    this.weatherLocationError = '';
    this.calendarService.updateProfileWeatherLocation(parsedId).subscribe({
      next: (profileWeather) => {
        this.weatherLocations = profileWeather.locations;
        this.selectedWeatherLocationId = profileWeather.selected_location_id;
        this.weatherLocationLoading = false;
      },
      error: (error: unknown) => {
        this.weatherLocationLoading = false;
        this.weatherLocationError = error instanceof HttpErrorResponse
          ? error.error?.detail ?? 'Wetterstandort konnte nicht gespeichert werden.'
          : 'Wetterstandort konnte nicht gespeichert werden.';
      },
    });
  }

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
}
