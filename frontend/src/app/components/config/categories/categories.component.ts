import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { CalendarService, Category } from '../../../services/calendar.service';
import { AdminEditorActions } from '../admin-editor-actions';
import { ColorPickerComponent } from '../color-picker/color-picker.component';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, ColorPickerComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.css'
})
export class CategoriesComponent implements OnInit, OnChanges {
  @Input() selectedCategoryId: number | null = null;
  @Output() selectedCategoryChange = new EventEmitter<number | null>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly calendarService = inject(CalendarService);
  public dbCategories: Category[] = [];
  public tempCatLabel = '';
  public tempCatShort = '';
  public tempCatColor = '#adb5bd';
  public saving = false;
  public errorMessage = '';
  private savedSnapshot = '';

  ngOnInit(): void {
    this.calendarService.categories$.subscribe((categories) => {
      this.dbCategories = categories;
      this.loadSelectedCategory();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedCategoryId']) this.loadSelectedCategory();
  }

  loadSelectedCategory(): void {
    const category = this.dbCategories.find((item) => item.id === this.selectedCategoryId);
    this.tempCatLabel = category?.label ?? '';
    this.tempCatShort = category?.default_short ?? '';
    this.tempCatColor = category?.color ?? '#adb5bd';
    this.savedSnapshot = this.formSnapshot();
    this.errorMessage = '';
    this.publishEditorActions();
  }

  publishEditorActions(): void {
    this.editorActionsChange.emit({
      dirty: this.formSnapshot() !== this.savedSnapshot,
      canDelete: this.selectedCategoryId !== null,
      busy: this.saving,
      save: () => this.saveCategory(),
      cancel: () => this.cancelChanges(),
      delete: () => this.deleteCategory(),
    });
  }

  saveCategory(): void {
    const label = this.tempCatLabel.trim();
    const short = this.tempCatShort.trim();
    if (!label || !short) {
      this.errorMessage = 'Name und Kürzel dürfen nicht leer sein.';
      return;
    }

    this.saving = true;
    this.errorMessage = '';
    this.publishEditorActions();
    const request = this.selectedCategoryId === null
      ? this.apiService.createCategory({
        value: this.categoryValue(label),
        label,
        color: this.tempCatColor,
        default_short: short,
      })
      : this.apiService.updateCategory(this.selectedCategoryId, label, this.tempCatColor, short);
    request.subscribe({
      next: (category) => {
        this.saving = false;
        if (this.selectedCategoryId === null && 'id' in category) {
          this.selectedCategoryId = category.id;
          this.selectedCategoryChange.emit(category.id);
        }
        this.savedSnapshot = this.formSnapshot();
        this.calendarService.loadCategories();
        this.publishEditorActions();
      },
      error: () => {
        this.saving = false;
        this.errorMessage = 'Kategorie konnte nicht gespeichert werden.';
        this.publishEditorActions();
      },
    });
  }

  cancelChanges(): void {
    this.saving = true;
    this.publishEditorActions();
    this.calendarService.reloadCategories().subscribe({
      next: (categories) => {
        this.dbCategories = categories;
        this.saving = false;
        this.loadSelectedCategory();
      },
      error: () => {
        this.saving = false;
        this.errorMessage = 'Kategorien konnten nicht neu geladen werden.';
        this.publishEditorActions();
      },
    });
  }

  private deleteCategory(): void {
    if (this.selectedCategoryId === null) return;
    const category = this.dbCategories.find((item) => item.id === this.selectedCategoryId);
    if (!category || !confirm(`Kategorie „${category.label}“ wirklich löschen?`)) return;
    this.saving = true;
    this.publishEditorActions();
    this.apiService.deleteCategory(category.id).subscribe({
      next: () => {
        this.selectedCategoryId = null;
        this.selectedCategoryChange.emit(null);
        this.calendarService.loadCategories();
        this.saving = false;
        this.publishEditorActions();
      },
      error: (error: { error?: { detail?: string } }) => {
        this.saving = false;
        this.errorMessage = error.error?.detail ?? 'Kategorie konnte nicht gelöscht werden.';
        this.publishEditorActions();
      },
    });
  }

  private formSnapshot(): string {
    return JSON.stringify([this.tempCatLabel, this.tempCatShort, this.tempCatColor]);
  }

  private categoryValue(label: string): string {
    return label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50)
      || 'category';
  }
}
