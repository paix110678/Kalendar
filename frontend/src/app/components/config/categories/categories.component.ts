import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService } from '../../../services/calendar.service'; // Pfadtiefe an Ordnerstruktur angepasst

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.css'
})
export class CategoriesComponent implements OnInit {
  private calendarService = inject(CalendarService);
  public dbCategories: any[] = [];

  public editingCatId: number | null = null;
  public tempCatLabel = '';
  public tempCatShort = '';
  public tempCatColor = '#adb5bd';

  ngOnInit(): void {
    this.calendarService.categories$.subscribe((cats: any[]) => {
      this.dbCategories = cats;
    });
  }

  startEditCat(cat: any): void {
    this.editingCatId = cat.id;
    this.tempCatLabel = cat.label;
    this.tempCatShort = cat.default_short;
    this.tempCatColor = cat.color;
  }

  saveCatEdit(catId: number): void {
    if (!this.tempCatLabel.trim() || !this.tempCatShort.trim()) return;
    this.calendarService.updateCategory(catId, this.tempCatLabel, this.tempCatColor, this.tempCatShort).subscribe(() => {
      this.editingCatId = null;
    });
  }
}
