import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, WeatherLocation } from '../../../../../services/api.service';
import { CalendarService } from '../../../../../services/calendar.service';
import { ToastService } from '../../../../../services/toast.service';
import { AdminEditorActions } from '../../action-footer/action-footer.component';

@Component({
  selector: 'app-system',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './system.component.html',
  styleUrl: './system.component.css',
})
export class SystemComponent implements OnChanges {
  @Input() selectedLocationId: number | null = null;
  @Output() locationsChanged = new EventEmitter<WeatherLocation[]>();
  @Output() selectedLocationChanged = new EventEmitter<number | null>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly toastService = inject(ToastService);

  public locations: WeatherLocation[] = [];
  public locationForm = {
    weather_plz: '',
    weather_city: '',
    weather_latitude: null as number | null,
    weather_longitude: null as number | null,
  };
  public editingLocationId: number | null = null;
  public creatingLocation = false;
  public loading = false;
  public configMessage = '';
  public configError = false;
  private locationsLoaded = false;
  private savedFormSnapshot = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['selectedLocationId']) return;
    this.creatingLocation = false;
    if (!this.locationsLoaded) {
      this.loadLocations();
    } else {
      this.selectLocation(this.selectedLocationId);
      this.publishEditorActions();
    }
  }

  selectLocationFromTree(locationId: number): void {
    this.selectedLocationId = locationId;
    if (this.locationsLoaded) this.selectLocation(locationId);
    this.publishEditorActions();
  }

  startCreatingLocation(): void {
    this.creatingLocation = true;
    this.editingLocationId = null;
    this.locationForm = {
      weather_plz: '',
      weather_city: '',
      weather_latitude: null,
      weather_longitude: null,
    };
    this.configMessage = '';
    this.configError = false;
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  private loadLocations(): void {
    this.loading = true;
    this.publishEditorActions();
    this.apiService.getWeatherLocations().subscribe({
      next: (locations) => {
        this.loading = false;
        this.locationsLoaded = true;
        this.locations = locations;
        this.locationsChanged.emit(locations);
        this.selectLocation(this.selectedLocationId);
        this.publishEditorActions();
      },
      error: () => {
        this.loading = false;
        this.configError = true;
        this.configMessage = 'Wetterstandorte konnten nicht geladen werden.';
        this.toastService.show(false, this.configMessage);
        this.publishEditorActions();
      },
    });
  }

  private selectLocation(locationId: number | null): void {
    if (locationId === null) {
      this.startCreatingLocation();
      return;
    }

    this.editingLocationId = locationId;
    const location = this.locations.find((item) => item.id === locationId);
    this.locationForm = location
      ? {
          weather_plz: location.weather_plz,
          weather_city: location.weather_city,
          weather_latitude: location.weather_latitude,
          weather_longitude: location.weather_longitude,
        }
      : { weather_plz: '', weather_city: '', weather_latitude: null, weather_longitude: null };
    this.creatingLocation = false;
    this.configMessage = location?.location_error ?? '';
    this.configError = !!location?.location_error;
    this.savedFormSnapshot = this.formSnapshot();
  }

  private createLocation(): void {
    const postalCode = this.locationForm.weather_plz.trim();
    if (!/^\d{5}$/.test(postalCode)) {
      this.showRequestError('Bitte gib eine fünfstellige Postleitzahl ein.');
      return;
    }
    this.loading = true;
    this.publishEditorActions();
    this.apiService.createWeatherLocation({ weather_plz: postalCode }).subscribe({
      next: (location) => {
        this.locations = [...this.locations, location];
        this.locationsLoaded = true;
        this.locationsChanged.emit(this.locations);
        this.editingLocationId = location.id;
        this.creatingLocation = false;
        this.setForm(location);
        this.selectedLocationChanged.emit(location.id);
        this.calendarService.loadProfileWeather();
        this.showLocationResult(location, 'Standort wurde hinzugefügt.');
      },
      error: () => this.showRequestError('Standort konnte nicht hinzugefügt werden.'),
    });
  }

  private deleteLocation(): void {
    const locationId = this.selectedLocationId ?? this.editingLocationId;
    if (locationId === null) return;
    this.loading = true;
    this.publishEditorActions();
    this.apiService.deleteWeatherLocation(locationId).subscribe({
      next: () => {
        this.apiService.getWeatherLocations().subscribe({
          next: (locations) => {
            this.loading = false;
            this.locationsLoaded = true;
            this.locations = locations;
            this.locationsChanged.emit(locations);
            this.selectedLocationChanged.emit(locations[0]?.id ?? null);
            this.calendarService.loadProfileWeather();
            this.configMessage = '';
            this.configError = false;
            this.publishEditorActions();
          },
          error: () => {
            const message = 'Wetterstandort wurde gelöscht, aber die Liste konnte nicht aktualisiert werden.';
            this.loading = false;
            this.configError = true;
            this.configMessage = message;
            this.toastService.show(false, message);
            this.publishEditorActions();
          },
        });
      },
      error: (error: { error?: { detail?: string } }) =>
        this.showRequestError(error.error?.detail ?? 'Standort konnte nicht gelöscht werden.'),
    });
  }

  private setForm(location: WeatherLocation): void {
    this.locationForm = {
      weather_plz: location.weather_plz,
      weather_city: location.weather_city,
      weather_latitude: location.weather_latitude,
      weather_longitude: location.weather_longitude,
    };
    this.editingLocationId = location.id;
    this.creatingLocation = false;
    this.savedFormSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  private showLocationResult(location: WeatherLocation, successMessage: string): void {
    this.loading = false;
    this.configError = !!location.location_error;
    this.configMessage = location.location_error ?? successMessage;
    if (location.location_error) this.toastService.show(false, location.location_error);
    this.publishEditorActions();
  }

  private showRequestError(message: string): void {
    this.loading = false;
    this.configError = true;
    this.configMessage = message;
    this.publishEditorActions();
  }

  publishEditorActions(): void {
    const dirty = this.formSnapshot() !== this.savedFormSnapshot;
    if (this.creatingLocation) {
      this.editorActionsChange.emit({
        dirty,
        canDelete: false,
        busy: this.loading,
        saveLabel: 'Wetterstandorte hinzufügen',
        cancelLabel: 'Verwerfen',
        save: () => this.createLocation(),
        cancel: () => this.cancelChanges(),
      });
      return;
    }

    if (this.selectedLocationId === null) {
      this.editorActionsChange.emit({
        dirty: false,
        canDelete: false,
        busy: this.loading,
        showSave: true,
        hideCancel: true,
        saveLabel: 'Wetterstandorte hinzufügen',
        save: () => this.startCreatingLocation(),
        cancel: () => {},
      });
      return;
    }

    this.editorActionsChange.emit({
      dirty: false,
      canDelete: this.selectedLocationId !== null,
      busy: this.loading,
      hideSave: true,
      hideCancel: true,
      save: () => {},
      cancel: () => {},
      delete: () => this.deleteLocation(),
    });
  }

  cancelChanges(): void {
    this.creatingLocation = false;
    this.locationForm = {
      weather_plz: '',
      weather_city: '',
      weather_latitude: null,
      weather_longitude: null,
    };
    this.configMessage = '';
    this.configError = false;
    this.publishEditorActions();
  }

  private formSnapshot(): string {
    return this.locationForm.weather_plz.trim();
  }
}
