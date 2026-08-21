import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService } from '../../../services/calendar.service'; // Pfadtiefe an Ordnerstruktur angepasst

@Component({
  selector: 'app-system',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './system.component.html',
  styleUrl: './system.component.css'
})
export class SystemComponent implements OnInit {
  private calendarService = inject(CalendarService);

  public localConfig!: any;
  public showPasswordPrompt = false;
  public passwordInput = '';
  public passwordError = '';

  ngOnInit(): void {
    this.calendarService.config$.subscribe((cfg: any) => {
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
        this.calendarService.updateSystemConfig(this.localConfig).subscribe();
      },
      error: () => this.passwordError = 'Kennwort inkorrekt.'
    });
  }
}
