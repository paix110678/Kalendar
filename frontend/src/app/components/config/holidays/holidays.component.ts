import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, GERMAN_STATES, Holiday, HolidayStateData } from '../../../services/api.service';

interface HolidayYearGroup {
  year: number;
  holidays: Holiday[];
}

@Component({
  selector: 'app-holidays',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './holidays.component.html',
  styleUrl: './holidays.component.css',
})
export class HolidaysComponent implements OnInit, OnChanges {
  private readonly apiService = inject(ApiService);

  @Input() selectedStateCode: string | null = null;
  @Input() savedStateCodes: string[] = [];
  @Output() stateAdded = new EventEmitter<HolidayStateData>();

  readonly bundeslaender = GERMAN_STATES;

  newStateCode = '';
  holidays: Holiday[] = [];
  loading = false;
  saving = false;
  errorMessage = '';
  successMessage = '';

  get availableStates() {
    return this.bundeslaender.filter((state) => !this.savedStateCodes.includes(state.code));
  }

  get selectedStateName(): string {
    return this.bundeslaender.find((state) => state.code === this.selectedStateCode)?.name
      ?? this.selectedStateCode
      ?? '';
  }

  get holidayGroups(): HolidayYearGroup[] {
    const groups = new Map<number, Holiday[]>();
    for (const holiday of this.holidays) {
      const entries = groups.get(holiday.year) ?? [];
      entries.push(holiday);
      groups.set(holiday.year, entries);
    }

    return Array.from(groups, ([year, holidays]) => ({
      year,
      holidays: holidays.sort((left, right) =>
        left.start_date.localeCompare(right.start_date) || left.name.localeCompare(right.name),
      ),
    })).sort((left, right) => left.year - right.year);
  }

  ngOnInit(): void {
    this.loadSelectedState();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedStateCode'] && !changes['selectedStateCode'].firstChange) {
      this.loadSelectedState();
    }
  }

  addState(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (!this.newStateCode) {
      this.errorMessage = 'Bitte ein Bundesland auswählen.';
      return;
    }
    if (this.savedStateCodes.includes(this.newStateCode)) {
      this.errorMessage = 'Dieses Bundesland ist bereits gespeichert.';
      return;
    }

    this.saving = true;
    this.apiService.addHolidayState(this.newStateCode).subscribe({
      next: (data) => {
        this.holidays = data.holidays;
        this.stateAdded.emit(data);
        this.successMessage = `Ferien und Feiertage für ${this.stateName(data.state_code)} (${data.years.join(', ')}) wurden geladen und gespeichert.`;
        this.newStateCode = '';
        this.saving = false;
      },
      error: (error: unknown) => {
        this.errorMessage = this.describeError(error, 'Das Bundesland konnte nicht hinzugefügt werden.');
        this.saving = false;
      },
    });
  }

  formatDate(date: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : date;
  }

  stateName(code: string): string {
    return this.bundeslaender.find((state) => state.code === code)?.name ?? code;
  }

  private loadSelectedState(): void {
    if (!this.selectedStateCode) {
      this.holidays = [];
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.apiService.getHolidays(this.selectedStateCode).subscribe({
      next: (holidays) => {
        this.holidays = holidays;
        this.loading = false;
      },
      error: (error: unknown) => {
        this.holidays = [];
        this.loading = false;
        this.errorMessage = this.describeError(error, 'Gespeicherte Ferien konnten nicht geladen werden.');
      },
    });
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return 'Backend oder Ferien-API sind nicht erreichbar. Bitte Verbindung und API prüfen.';
    }
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'Dieses Bundesland wurde bereits hinzugefügt. Bitte aktualisieren.';
    }
    if (error instanceof HttpErrorResponse && error.status === 422) {
      return 'Das ausgewählte Bundesland ist ungültig.';
    }
    if (error instanceof HttpErrorResponse && error.status === 502) {
      return 'OpenHolidays ist nicht erreichbar oder hat ungültige Daten geliefert. Es wurden keine Daten gespeichert.';
    }
    return fallback;
  }
}
