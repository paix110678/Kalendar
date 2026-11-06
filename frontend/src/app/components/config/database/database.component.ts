import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, ViewChild, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, DatabaseBackup, DatabaseBackupList } from '../../../services/api.service';
import { AdminEditorActions } from '../admin-editor-actions';

@Component({
  selector: 'app-database',
  standalone: true,
  imports: [CommonModule],
  // KORREKTUR: Template- und Stylesheet-Pfade präzise auf die eigene Komponente umgestellt!
  templateUrl: './database.component.html',
  styleUrl: './database.component.css'
})
export class DatabaseComponent implements OnInit, OnChanges {
  @ViewChild('backupFileInput') private backupFileInput?: ElementRef<HTMLInputElement>;
  @Input() dbTables: string[] = [];
  @Input() selectedBackupId: string | null = null;
  @Output() backupsChanged = new EventEmitter<DatabaseBackupList>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();
  @Output() selectedBackupIdChange = new EventEmitter<string | null>();
  
  private apiService = inject(ApiService);
  private cdr = inject(ChangeDetectorRef);

  public selectedTableName: string | null = null;
  public currentTableColumns: string[] = [];
  public currentTableRows: any[] = [];
  public backups: DatabaseBackup[] = [];
  public backupErrors: Array<{ file: string; error: string }> = [];
  public backupsLoading = false;
  public backupSaving = false;
  public backupDeleting = false;
  public backupUploading = false;
  public restoringBackupId: string | null = null;
  public backupError = '';
  public backupMessage = '';
  private readonly maxBackupFileSize = 50 * 1024 * 1024;

  ngOnInit(): void {
    this.refreshBackups();
    this.publishEditorActions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedBackupId']) this.publishEditorActions();
    if (changes['selectedBackupId'] && this.selectedBackupId) {
      this.focusBackup(this.selectedBackupId);
    }
  }

  public refreshBackups(): void {
    this.backupsLoading = true;
    this.backupError = '';
    this.apiService.getDatabaseBackups().subscribe({
      next: (result) => {
        this.backups = result.backups;
        this.backupErrors = result.errors;
        this.backupsLoading = false;
        this.backupsChanged.emit(result);
        this.publishEditorActions();
        this.cdr.markForCheck();
        if (this.selectedBackupId) {
          this.focusBackup(this.selectedBackupId);
        }
      },
      error: (error: unknown) => {
        console.error('Datenbankbackups konnten nicht geladen werden:', error);
        this.backupsLoading = false;
        this.backupError = 'Backups konnten nicht geladen werden.';
        this.cdr.markForCheck();
      },
    });
  }

  public createBackup(): void {
    this.backupSaving = true;
    this.backupError = '';
    this.backupMessage = '';
    this.publishEditorActions();
    this.apiService.createDatabaseBackup().subscribe({
      next: (backup) => {
        this.backupSaving = false;
        this.backupMessage = `Backup vom ${this.formatBackupDate(backup.created_at)} wurde erstellt.`;
        this.refreshBackups();
        this.publishEditorActions();
        this.cdr.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Datenbankbackup konnte nicht erstellt werden:', error);
        this.backupSaving = false;
        this.backupError = 'Backup konnte nicht erstellt werden.';
        this.publishEditorActions();
        this.cdr.markForCheck();
      },
    });
  }

  public publishEditorActions(): void {
    const selected = this.backups.find((backup) => backup.id === this.selectedBackupId);
    this.editorActionsChange.emit({
      dirty: false,
      canDelete: selected !== undefined,
      showSave: this.selectedBackupId === null,
      saveLabel: 'Backup erstellen',
      busy: this.backupsLoading || this.backupSaving || this.backupDeleting
        || this.backupUploading || this.restoringBackupId !== null,
      save: () => this.createBackup(),
      cancel: () => this.refreshBackups(),
      delete: () => this.deleteSelectedBackup(),
    });
  }

  private deleteSelectedBackup(): void {
    const selected = this.backups.find((backup) => backup.id === this.selectedBackupId);
    if (!selected || !confirm(`Backup vom ${this.formatBackupDate(selected.created_at)} wirklich löschen?`)) return;
    this.backupError = '';
    this.backupDeleting = true;
    this.publishEditorActions();
    this.apiService.deleteDatabaseBackup(selected.id).subscribe({
      next: () => {
        this.backupDeleting = false;
        this.selectedBackupIdChange.emit(null);
        this.refreshBackups();
      },
      error: (error: unknown) => {
        console.error(`Datenbankbackup ${selected.id} konnte nicht gelöscht werden:`, error);
        this.backupDeleting = false;
        this.backupError = 'Backup konnte nicht gelöscht werden.';
        this.publishEditorActions();
        this.cdr.markForCheck();
      },
    });
  }

  public downloadBackup(backup: DatabaseBackup): void {
    this.backupError = '';
    this.apiService.downloadDatabaseBackup(backup.id).subscribe({
      next: (file) => {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${backup.id}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        console.error(`Datenbankbackup ${backup.id} konnte nicht heruntergeladen werden:`, error);
        this.backupError = 'Backup konnte nicht heruntergeladen werden.';
        this.cdr.markForCheck();
      },
    });
  }

  public restoreBackup(backup: DatabaseBackup): void {
    if (!confirm(
      `Datenbank wirklich mit dem Backup vom ${this.formatBackupDate(backup.created_at)} ersetzen? `
      + 'Vor dem Ersetzen wird ein Wiederherstellungsbackup des aktuellen Stands erstellt.',
    )) {
      return;
    }

    this.restoringBackupId = backup.id;
    this.backupError = '';
    this.backupMessage = '';
    this.apiService.restoreDatabaseBackup(backup.id).subscribe({
      next: () => {
        this.backupMessage = 'Backup wiederhergestellt. Die Anwendung wird neu geladen.';
        this.cdr.markForCheck();
        window.setTimeout(() => window.location.reload(), 800);
      },
      error: (error: unknown) => {
        console.error(`Datenbankbackup ${backup.id} konnte nicht wiederhergestellt werden:`, error);
        this.restoringBackupId = null;
        this.backupError = 'Backup konnte nicht wiederhergestellt werden; die aktuelle Datenbank blieb erhalten.';
        this.cdr.markForCheck();
      },
    });
  }

  public chooseBackupFile(): void {
    this.backupFileInput?.nativeElement.click();
  }

  public async onBackupFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.backupError = '';
    this.backupMessage = '';
    if (!file.name.toLowerCase().endsWith('.json')) {
      this.backupError = 'Bitte wähle ein JSON-Backup aus der Datenbankverwaltung.';
      return;
    }
    if (file.size > this.maxBackupFileSize) {
      this.backupError = 'Die Backup-Datei darf höchstens 50 MB groß sein.';
      return;
    }
    if (!confirm(
      `Die Datenbank auf diesem Server wird vollständig durch „${file.name}“ ersetzt. `
      + 'Vorher wird automatisch ein Wiederherstellungsbackup des aktuellen Stands erstellt. Fortfahren?',
    )) {
      return;
    }

    this.backupUploading = true;
    this.publishEditorActions();
    try {
      const payload: unknown = JSON.parse(await file.text());
      this.apiService.restoreDatabaseBackupFile(payload).subscribe({
        next: () => {
          this.backupUploading = false;
          this.backupMessage = 'Datei eingespielt. Das vorherige Server-Backup bleibt zur Wiederherstellung erhalten.';
          this.refreshBackups();
          this.publishEditorActions();
          this.cdr.markForCheck();
          window.setTimeout(() => window.location.reload(), 1500);
        },
        error: (error: unknown) => {
          console.error('Datenbankbackup aus Datei konnte nicht wiederhergestellt werden:', error);
          this.backupUploading = false;
          this.backupError = 'Datei konnte nicht eingespielt werden. Die bisherige Datenbank blieb erhalten.';
          this.publishEditorActions();
          this.cdr.markForCheck();
        },
      });
    } catch (error) {
      console.error('Datenbankbackup-Datei konnte nicht gelesen werden:', error);
      this.backupUploading = false;
      this.backupError = 'Die Datei konnte nicht gelesen werden. Bitte wähle ein gültiges JSON-Backup.';
      this.publishEditorActions();
      this.cdr.markForCheck();
    }
  }

  public formatBackupDate(date: string): string {
    const parsedDate = new Date(date);
    return Number.isNaN(parsedDate.getTime())
      ? date
      : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(parsedDate);
  }

  public formatBackupSize(bytes: number): string {
    return bytes < 1024
      ? `${bytes} B`
      : `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;
  }

  private focusBackup(backupId: string): void {
    window.setTimeout(() => {
      document.getElementById(`database-backup-${backupId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  public openTableContent(tableName: string): void {
    this.selectedTableName = tableName;
    this.apiService.getTableData(tableName).subscribe((res: { columns: string[], rows: any[] }) => {
      this.currentTableColumns = res.columns;
      this.currentTableRows = res.rows;
      this.cdr.detectChanges(); // Garantiert die verzögerungsfreie Live-Anzeige beim ersten Klick
    });
  }
}
