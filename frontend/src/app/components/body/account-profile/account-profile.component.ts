import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, inject, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { CalendarService } from '../../../services/calendar.service';
import { WeatherLocation } from '../../../services/api.service';

@Component({
  selector: 'app-account-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account-profile.component.html',
  styleUrl: './account-profile.component.css',
})
export class AccountProfileComponent implements OnInit {
  public readonly authService = inject(AuthService);
  private readonly calendarService = inject(CalendarService);

  @Output() closed = new EventEmitter<void>();

  public logoutError = '';
  public weatherLocations: WeatherLocation[] = [];
  public selectedWeatherLocationId: number | null = null;
  public weatherLocationLoading = false;
  public weatherLocationError = '';

  ngOnInit(): void {
    this.loadWeatherProfile();
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
      next: () => this.closed.emit(),
      error: (error: unknown) => {
        this.logoutError = error instanceof HttpErrorResponse
          ? error.error?.detail ?? 'Abmeldung fehlgeschlagen.'
          : 'Abmeldung fehlgeschlagen.';
      },
    });
  }
}
