import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ApiService, PlatformStatistics } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-platform-statistics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-statistics.component.html',
  styleUrl: './platform-statistics.component.css',
})
export class PlatformStatisticsComponent implements OnInit {
  statistics: PlatformStatistics | null = null;
  loading = false;
  error = '';
  accountActionError = '';
  deletingAccountId: number | null = null;
  updatedAt: Date | null = null;

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadStatistics();
  }

  loadStatistics(): void {
    this.loading = true;
    this.error = '';
    this.apiService.getPlatformStatistics().subscribe({
      next: (statistics) => {
        this.statistics = statistics;
        this.updatedAt = new Date();
        this.loading = false;
      },
      error: (error: unknown) => {
        this.error = error instanceof HttpErrorResponse
          ? error.error?.detail ?? 'Die Statistik konnte nicht geladen werden.'
          : 'Die Statistik konnte nicht geladen werden.';
        this.loading = false;
      },
    });
  }

  isCurrentAccount(accountId: number): boolean {
    return this.authService.currentAccount?.id === accountId;
  }

  deleteAccount(account: PlatformStatistics['accounts'][number]): void {
    if (this.isCurrentAccount(account.id) || this.deletingAccountId !== null) return;
    const confirmed = confirm(
      `Login-Konto ${account.email} und das zugehörige Familienprofil mit dessen Kalender- und Plan-Einträgen endgültig löschen? `
      + 'Gemeinsame Aufgaben, Pläne sowie Daten anderer Mitglieder bleiben erhalten.',
    );
    if (!confirmed) return;

    this.deletingAccountId = account.id;
    this.accountActionError = '';
    this.apiService.deletePlatformAccount(account.id).subscribe({
      next: () => {
        this.deletingAccountId = null;
        this.loadStatistics();
      },
      error: (error: unknown) => {
        this.deletingAccountId = null;
        this.accountActionError = error instanceof HttpErrorResponse
          ? error.error?.detail ?? 'Das Konto konnte nicht gelöscht werden.'
          : 'Das Konto konnte nicht gelöscht werden.';
      },
    });
  }
}
