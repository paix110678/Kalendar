import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ApiService, PlatformStatistics } from '../../../services/api.service';

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
  updatedAt: Date | null = null;

  constructor(private readonly apiService: ApiService) {}

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
}
