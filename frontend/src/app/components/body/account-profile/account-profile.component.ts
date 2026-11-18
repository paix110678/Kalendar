import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, inject, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import {
  ApiService,
  HeaderPreferences,
  UpdateUserProfileResult,
  WeatherLocation,
} from '../../../services/api.service';
import { CalendarService, User } from '../../../services/calendar.service';
import { forkJoin, of, Subscription } from 'rxjs';
import { ColorPickerComponent } from '../config/main/color-picker/color-picker.component';

const DEFAULT_PREFERENCES: HeaderPreferences = {
  show_users: true,
  show_view_mode: true,
  show_weather: true,
};

@Component({
  selector: 'app-account-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, ColorPickerComponent],
  templateUrl: './account-profile.component.html',
  styleUrls: ['./account-profile.component.css', './account-profile-settings.css'],
})
export class AccountProfileComponent implements OnDestroy, OnInit {
  public readonly authService = inject(AuthService);
  private readonly calendarService = inject(CalendarService);
  private readonly apiService = inject(ApiService);
  private readonly subscriptions = new Subscription();

  @Output() closed = new EventEmitter<void>();

  public logoutError = '';
  public weatherLocations: WeatherLocation[] = [];
  public selectedWeatherLocationId: number | null = null;
  public weatherLocationLoading = false;
  public weatherLocationError = '';
  public familyProfiles: User[] = [];
  public profileDrafts: User[] = [];
  public displayPreferences: HeaderPreferences = { ...DEFAULT_PREFERENCES };
  public profileSettingsLoading = true;
  public profileSettingsSaving = false;
  public profileSettingsError = '';
  public profileSettingsLoadError = '';
  public profileSettingsMessage = '';
  private savedDisplayPreferences: HeaderPreferences | null = null;
  private savedProfilesSnapshot = JSON.stringify([]);
  private savedProfileValues = new Map<number, { color_code: string; is_active: boolean }>();

  ngOnInit(): void {
    this.loadWeatherProfile();
    if (this.canManageProfileSettings) {
      this.subscriptions.add(
        this.calendarService.users$.subscribe((profiles) => {
          this.familyProfiles = profiles;
          if (!this.profileSettingsSaving && !this.profileSettingsDirty) {
            this.syncProfileDrafts(profiles);
          }
        }),
      );
      this.loadProfileSettings();
    } else {
      this.profileSettingsLoading = false;
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get canManageProfileSettings(): boolean {
    return this.authService.currentAccount?.role === 'admin';
  }

  get profileSettingsDirty(): boolean {
    return this.profileSnapshot() !== this.savedProfilesSnapshot
      || (
        this.savedDisplayPreferences !== null
        && JSON.stringify(this.displayPreferences) !== JSON.stringify(this.savedDisplayPreferences)
      );
  }

  get hasLoadedDisplayPreferences(): boolean {
    return this.savedDisplayPreferences !== null;
  }

  private loadProfileSettings(): void {
    this.apiService.getHeaderPreferences().subscribe({
      next: (preferences) => {
        this.displayPreferences = { ...preferences };
        this.savedDisplayPreferences = { ...preferences };
        this.profileSettingsLoading = false;
      },
      error: (error: unknown) => {
        console.error('Anzeigeeinstellungen konnten nicht geladen werden:', error);
        this.profileSettingsLoadError = 'Anzeigeoptionen konnten nicht geladen werden.';
        this.profileSettingsLoading = false;
      },
    });
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

  saveProfileSettings(): void {
    if (!this.canManageProfileSettings || this.profileSettingsLoading || this.profileSettingsSaving) return;
    const changedProfiles = this.profileDrafts.filter((profile) => {
      const saved = this.savedProfileValues.get(profile.id);
      return !saved || saved.color_code !== profile.color_code || saved.is_active !== profile.is_active;
    });
    const preferencesChanged = this.savedDisplayPreferences !== null
      && JSON.stringify(this.displayPreferences) !== JSON.stringify(this.savedDisplayPreferences);
    if (changedProfiles.length === 0 && !preferencesChanged) return;

    this.profileSettingsSaving = true;
    this.profileSettingsError = '';
    this.profileSettingsMessage = '';
    const preferencesRequest = preferencesChanged
      ? this.calendarService.updateHeaderPreferences(this.displayPreferences)
      : of(this.displayPreferences);
    const profilesRequest = changedProfiles.length > 0
      ? forkJoin(changedProfiles.map((profile) => {
        const latestProfile = this.familyProfiles.find(({ id }) => id === profile.id) ?? profile;
        return this.calendarService.updateUserProfile(
          profile.id,
          this.profilePayload({
            ...latestProfile,
            color_code: profile.color_code,
            is_active: profile.is_active,
          }),
        );
      }))
      : of([] as UpdateUserProfileResult[]);

    forkJoin({ preferences: preferencesRequest, profiles: profilesRequest }).subscribe({
      next: ({ preferences, profiles }) => {
        this.displayPreferences = { ...preferences };
        if (preferencesChanged) this.savedDisplayPreferences = { ...preferences };
        const updatedProfiles = new Map(profiles.map(({ user }) => [user.id, user]));
        this.profileDrafts = this.profileDrafts.map((profile) =>
          updatedProfiles.get(profile.id) ?? profile,
        );
        this.updateSavedProfileValues();
        this.profileSettingsSaving = false;
        this.profileSettingsMessage = 'Profil- und Anzeigeeinstellungen wurden gespeichert.';
      },
      error: (error: unknown) => {
        console.error('Profil- und Anzeigeeinstellungen konnten nicht vollständig gespeichert werden:', error);
        this.profileSettingsSaving = false;
        this.profileSettingsError = 'Einstellungen konnten nicht vollständig gespeichert werden. Bitte prüfe die Änderungen und versuche es erneut.';
      },
    });
  }

  cancelProfileSettings(): void {
    this.syncProfileDrafts(this.familyProfiles);
    if (this.savedDisplayPreferences) {
      this.displayPreferences = { ...this.savedDisplayPreferences };
    }
    this.profileSettingsError = '';
    this.profileSettingsMessage = '';
  }

  private syncProfileDrafts(profiles: User[]): void {
    this.profileDrafts = profiles.map((profile) => ({ ...profile }));
    this.updateSavedProfileValues();
  }

  private updateSavedProfileValues(): void {
    this.savedProfileValues = new Map(
      this.profileDrafts.map(({ id, color_code, is_active }) => [
        id,
        { color_code, is_active },
      ]),
    );
    this.savedProfilesSnapshot = this.profileSnapshot();
  }

  private profilePayload(profile: User): Pick<
    User,
    | 'name'
    | 'role'
    | 'color_code'
    | 'current_points'
    | 'status_school'
    | 'status_sport'
    | 'state_code'
    | 'is_active'
  > {
    return {
      name: profile.name,
      role: profile.role,
      color_code: profile.color_code,
      current_points: profile.current_points,
      status_school: profile.status_school,
      status_sport: profile.status_sport,
      state_code: profile.state_code,
      is_active: profile.is_active,
    };
  }

  private profileSnapshot(): string {
    return JSON.stringify(
      this.profileDrafts.map(({ id, color_code, is_active }) => [id, color_code, is_active]),
    );
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
