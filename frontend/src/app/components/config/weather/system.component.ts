import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, WeatherLocation } from '../../../services/api.service';
import { CalendarService } from '../../../services/calendar.service';
import { AdminEditorActions } from '../admin-editor-actions';

type WeatherLocationAction = 'create' | 'save' | 'activate' | 'delete';

@Component({
  selector: 'app-system',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './system.component.html',
  styleUrl: './system.component.css'
})
export class SystemComponent implements OnChanges {
  @Input() selectedLocationId: number | null = null;
  @Output() locationsChanged = new EventEmitter<WeatherLocation[]>();
  @Output() selectedLocationChanged = new EventEmitter<number>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);

  public locations: WeatherLocation[] = [];
  public locationForm = {
    name: '',
    weather_plz: '',
    weather_service: 'open_meteo' as 'open_meteo' | 'weather_api',
    api_key: '',
    weather_city: '',
    weather_latitude: null as number | null,
    weather_longitude: null as number | null,
    is_active: false,
  };
  public editingLocationId: number | null = null;
  public creatingLocation = false;
  public loading = false;
  public showPasswordPrompt = false;
  public passwordInput = '';
  public passwordError = '';
  public configMessage = '';
  public configError = false;
  private pendingAction: WeatherLocationAction | null = null;
  private savedFormSnapshot = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedLocationId']) {
      if (this.locations.length === 0) this.loadLocations();
      else if (this.selectedLocationId !== null) this.loadLocation(this.selectedLocationId);
      else this.startCreatingLocation();
    }
  }

  startCreatingLocation(): void {
    this.loading = false;
    this.creatingLocation = true;
    this.editingLocationId = null;
    this.locationForm = {
      name: '',
      weather_plz: '',
      weather_service: 'open_meteo',
      api_key: '',
      weather_city: '',
      weather_latitude: null,
      weather_longitude: null,
      is_active: false,
    };
    this.configMessage = '';
    this.configError = false;
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  triggerAction(action: WeatherLocationAction): void {
    this.pendingAction = action;
    this.showPasswordPrompt = true;
    this.passwordInput = '';
    this.passwordError = '';
  }

  cancelPasswordPrompt(): void {
    this.showPasswordPrompt = false;
    this.pendingAction = null;
    this.passwordInput = '';
    this.passwordError = '';
  }

  verifyAdminAction(): void {
    if (!this.pendingAction) return;
    this.calendarService.verifyAdminPassword(this.passwordInput).subscribe({
      next: () => {
        this.showPasswordPrompt = false;
        const action = this.pendingAction;
        this.pendingAction = null;
        if (action === 'create') this.createLocation();
        else if (action === 'save') this.saveLocation();
        else if (action === 'activate') this.activateLocation();
        else if (action === 'delete') this.deleteLocation();
      },
      error: () => this.passwordError = 'Kennwort inkorrekt.'
    });
  }

  private loadLocations(): void {
    this.loading = true;
    this.publishEditorActions();
    this.apiService.getWeatherLocations().subscribe({
      next: (locations) => {
        this.loading = false;
        this.locations = locations;
        this.locationsChanged.emit(locations);
        if (this.selectedLocationId !== null) this.loadLocation(this.selectedLocationId);
        else this.startCreatingLocation();
        this.publishEditorActions();
      },
      error: () => {
        this.loading = false;
        this.configError = true;
        this.configMessage = 'Wetterstandorte konnten nicht geladen werden.';
        this.publishEditorActions();
      }
    });
  }

  private loadLocation(locationId: number): void {
    this.loading = true;
    this.publishEditorActions();
    this.apiService.getWeatherLocation(locationId).subscribe({
      next: (location) => {
        this.loading = false;
        this.editingLocationId = location.id;
        this.creatingLocation = false;
        this.setForm(location);
        this.configMessage = '';
        this.configError = false;
        this.publishEditorActions();
      },
      error: () => {
        this.loading = false;
        this.configError = true;
        this.configMessage = 'Standortkonfiguration konnte nicht geladen werden.';
        this.publishEditorActions();
      }
    });
  }

  private createLocation(): void {
    this.loading = true;
    this.publishEditorActions();
    this.apiService.createWeatherLocation(this.locationPayload()).subscribe({
      next: (location) => {
        this.editingLocationId = location.id;
        this.creatingLocation = false;
        this.setForm(location);
        this.selectedLocationChanged.emit(location.id);
        this.refreshLocations();
        if (location.is_active) this.calendarService.loadSystemConfig();
        this.publishEditorActions();
        this.showLocationResult(location, 'Standort wurde hinzugefügt.');
      },
      error: () => this.showRequestError('Standort konnte nicht hinzugefügt werden.')
    });
  }

  private saveLocation(): void {
    if (this.editingLocationId === null) return;
    this.loading = true;
    this.publishEditorActions();
    this.apiService.updateWeatherLocation(this.editingLocationId, this.locationPayload()).subscribe({
      next: (location) => {
        this.setForm(location);
        this.refreshLocations();
        if (location.is_active) this.calendarService.loadSystemConfig();
        this.publishEditorActions();
        this.showLocationResult(location, 'Standort wurde gespeichert.');
      },
      error: () => this.showRequestError('Standort konnte nicht gespeichert werden.')
    });
  }

  private activateLocation(): void {
    if (this.editingLocationId === null) return;
    this.loading = true;
    this.publishEditorActions();
    this.apiService.activateWeatherLocation(this.editingLocationId).subscribe({
      next: (location) => {
        this.setForm(location);
        this.calendarService.loadSystemConfig();
        this.refreshLocations();
        this.showLocationResult(location, 'Standort wird jetzt für das Wetter verwendet.');
      },
      error: () => this.showRequestError('Standort konnte nicht aktiviert werden.')
    });
  }

  private deleteLocation(): void {
    if (this.editingLocationId === null) return;
    if (!confirm(`Standort „${this.locationForm.name}“ wirklich löschen?`)) return;
    const deletedActiveLocation = this.locationForm.is_active;
    this.loading = true;
    this.publishEditorActions();
    this.apiService.deleteWeatherLocation(this.editingLocationId).subscribe({
      next: () => {
        this.apiService.getWeatherLocations().subscribe({
          next: (locations) => {
            this.locations = locations;
            this.locationsChanged.emit(locations);
            this.loading = false;
            const nextLocation = locations.find((location) => location.is_active) ?? locations[0];
            if (nextLocation) {
              this.selectedLocationChanged.emit(nextLocation.id);
            } else {
              this.startCreatingLocation();
            }
          },
          error: () => this.showRequestError('Standort wurde gelöscht, aber die Standortliste konnte nicht aktualisiert werden.'),
        });
        if (deletedActiveLocation) this.calendarService.loadSystemConfig();
        this.configMessage = 'Standort wurde gelöscht.';
        this.configError = false;
      },
      error: (error: { error?: { detail?: string } }) =>
        this.showRequestError(error.error?.detail ?? 'Standort konnte nicht gelöscht werden.')
    });
  }

  private locationPayload(): Pick<WeatherLocation, 'name' | 'weather_plz' | 'weather_service' | 'api_key'> {
    return {
      name: this.locationForm.name.trim(),
      weather_plz: this.locationForm.weather_plz.trim(),
      weather_service: this.locationForm.weather_service,
      api_key: this.locationForm.api_key ?? '',
    };
  }

  private setForm(location: WeatherLocation): void {
    this.locationForm = {
      ...location,
      api_key: location.api_key ?? '',
    };
    this.editingLocationId = location.id;
    this.creatingLocation = false;
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  private refreshLocations(): void {
    this.apiService.getWeatherLocations().subscribe({
      next: (locations) => {
        this.locations = locations;
        this.locationsChanged.emit(locations);
      },
      error: () => {
        this.configError = true;
        this.configMessage = 'Standort wurde gespeichert, aber die Standortliste konnte nicht aktualisiert werden.';
      }
    });
  }

  private showLocationResult(location: WeatherLocation, successMessage: string): void {
    this.loading = false;
    this.configError = !!location.location_error;
    this.configMessage = location.location_error ?? successMessage;
    this.publishEditorActions();
  }

  private showRequestError(message: string): void {
    this.loading = false;
    this.configError = true;
    this.configMessage = message;
    this.publishEditorActions();
  }

  publishEditorActions(): void {
    this.editorActionsChange.emit({
      dirty: this.formSnapshot() !== this.savedFormSnapshot,
      canDelete: !this.creatingLocation && this.selectedLocationId !== null && this.editingLocationId !== null,
      busy: this.loading,
      saveLabel: this.creatingLocation ? 'Standort speichern' : 'Speichern',
      save: () => this.triggerAction(this.creatingLocation ? 'create' : 'save'),
      cancel: () => this.cancelChanges(),
      delete: () => this.triggerAction('delete'),
    });
  }

  cancelChanges(): void {
    this.cancelPasswordPrompt();
    this.loading = true;
    this.publishEditorActions();
    this.apiService.getWeatherLocations().subscribe({
      next: (locations) => {
        this.locations = locations;
        this.locationsChanged.emit(locations);
        const selected = this.selectedLocationId === null
          ? undefined
          : locations.find((location) => location.id === this.selectedLocationId);
        if (selected) {
          this.loadLocation(selected.id);
        }
        else this.startCreatingLocation();
        this.publishEditorActions();
      },
      error: () => this.showRequestError('Standort konnte nicht neu geladen werden.'),
    });
  }

  private formSnapshot(): string {
    return JSON.stringify({
      name: this.locationForm.name,
      weather_plz: this.locationForm.weather_plz,
      weather_service: this.locationForm.weather_service,
      api_key: this.locationForm.api_key,
    });
  }
}
