import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, SystemConfig } from '../../../services/calendar.service'; // Pfadtiefe an Ordnerstruktur angepasst

@Component({
  selector: 'app-system',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './system.component.html',
  styleUrl: './system.component.css'
})
export class SystemComponent implements OnInit {
  private calendarService = inject(CalendarService);

  public localConfig!: SystemConfig;
  public showPasswordPrompt = false;
  public passwordInput = '';
  public passwordError = '';
  public configMessage = '';
  public configError = false;

  ngOnInit(): void {
    this.calendarService.config$.subscribe((cfg) => {
      if (cfg) this.localConfig = { ...cfg };
    });
  }

  triggerConfigUpdateProtection(): void {
    this.showPasswordPrompt = true;
    this.passwordInput = '';
    this.passwordError = '';
  }

  verifyAdminAction(): void {
    this.calendarService.verifyAdminPassword(this.passwordInput).subscribe({
      next: () => {
        this.showPasswordPrompt = false;
        this.configMessage = '';
        this.calendarService.updateSystemConfig(this.localConfig).subscribe({
          next: (result) => {
            this.configError = !!result.location_error;
            this.configMessage = result.location_error
              ?? (result.location_resolved
                ? 'Einstellungen und Standort wurden gespeichert.'
                : 'Einstellungen wurden gespeichert. Für den Standort ist keine PLZ eingetragen.');
          },
          error: () => {
            this.configError = true;
            this.configMessage = 'Einstellungen konnten nicht gespeichert werden.';
          },
        });
      },
      error: () => this.passwordError = 'Kennwort inkorrekt.'
    });
  }
}
