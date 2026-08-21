import { Component, Input, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-database',
  standalone: true,
  imports: [CommonModule],
  // KORREKTUR: Template- und Stylesheet-Pfade präzise auf die eigene Komponente umgestellt!
  templateUrl: './database.component.html',
  styleUrl: './database.component.css'
})
export class DatabaseComponent {
  @Input() dbTables: string[] = [];
  
  private apiService = inject(ApiService);
  private cdr = inject(ChangeDetectorRef);

  public selectedTableName: string | null = null;
  public currentTableColumns: string[] = [];
  public currentTableRows: any[] = [];

  public openTableContent(tableName: string): void {
    this.selectedTableName = tableName;
    this.apiService.getTableData(tableName).subscribe((res: { columns: string[], rows: any[] }) => {
      this.currentTableColumns = res.columns;
      this.currentTableRows = res.rows;
      this.cdr.detectChanges(); // Garantiert die verzögerungsfreie Live-Anzeige beim ersten Klick
    });
  }
}

