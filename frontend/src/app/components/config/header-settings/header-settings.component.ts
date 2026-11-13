import { ChangeDetectorRef, Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, HeaderPreferences } from '../../../services/api.service';
import { CalendarService } from '../../../services/calendar.service';
import { ToastService } from '../../../services/toast.service';
import { AdminEditorActions } from '../admin-editor-actions';

const DEFAULT_PREFERENCES: HeaderPreferences = {
  show_users: true,
  show_view_mode: true,
  show_weather: true,
};

@Component({
  selector: 'app-header-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './header-settings.component.html',
  styleUrl: './header-settings.component.css',
})
export class HeaderSettingsComponent implements OnInit {
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toastService = inject(ToastService);
  private savedPreferences: HeaderPreferences = { ...DEFAULT_PREFERENCES };

  public preferences: HeaderPreferences = { ...DEFAULT_PREFERENCES };
  public loading = true;
  public saving = false;
  public message = '';
  public error = '';

  ngOnInit(): void {
    this.publishEditorActions();
    this.apiService.getHeaderPreferences().subscribe({
      next: (preferences) => {
        this.preferences = { ...preferences };
        this.savedPreferences = { ...preferences };
        this.loading = false;
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Kopfzeileneinstellungen konnten nicht geladen werden:', error);
        this.loading = false;
        this.error = 'Kopfzeileneinstellungen konnten nicht geladen werden.';
        this.toastService.show(false, this.error);
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
    });
  }

  public publishEditorActions(): void {
    this.editorActionsChange.emit({
      dirty: !this.loading && this.formSnapshot() !== JSON.stringify(this.savedPreferences),
      canDelete: false,
      busy: this.loading || this.saving,
      saveLabel: 'Einstellungen speichern',
      cancelLabel: 'Änderungen verwerfen',
      save: () => this.save(),
      cancel: () => this.cancel(),
    });
  }

  public save(): void {
    if (this.loading || this.saving) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    this.publishEditorActions();
    this.calendarService.updateHeaderPreferences(this.preferences).subscribe({
      next: (preferences) => {
        this.preferences = { ...preferences };
        this.savedPreferences = { ...preferences };
        this.saving = false;
        this.message = 'Kopfzeileneinstellungen wurden gespeichert.';
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Kopfzeileneinstellungen konnten nicht gespeichert werden:', error);
        this.saving = false;
        this.error = 'Einstellungen konnten nicht gespeichert werden.';
        this.publishEditorActions();
        this.changeDetector.markForCheck();
      },
    });
  }

  public cancel(): void {
    this.preferences = { ...this.savedPreferences };
    this.error = '';
    this.message = '';
    this.publishEditorActions();
  }

  private formSnapshot(): string {
    return JSON.stringify(this.preferences);
  }
}
