import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-view-mode-buttons',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './view-mode-buttons.component.html',
  styleUrls: [
    './view-mode-buttons.component.css',
    './view-mode-buttons.component.handy.css',
  ]
})
export class ViewModeButtonsComponent {
  @Input() currentViewMode: 'day' | '3days' | 'week' = 'day';
  @Output() viewModeChanged = new EventEmitter<'day' | '3days' | 'week'>();

  @ViewChild('viewModeTrigger') private viewModeTrigger?: ElementRef<HTMLButtonElement>;

  public readonly viewModes: { value: 'day' | '3days' | 'week'; label: string }[] = [
    { value: 'day', label: '1 Tag' },
    { value: '3days', label: '3 Tage' },
    { value: 'week', label: '7 Tage' },
  ];
  public isViewModeMenuOpen = false;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  public get currentViewModeLabel(): string {
    return this.viewModes.find((mode) => mode.value === this.currentViewMode)?.label ?? '1 Tag';
  }

  public changeViewMode(mode: 'day' | '3days' | 'week'): void {
    this.viewModeChanged.emit(mode);
  }

  public toggleViewModeMenu(): void {
    this.isViewModeMenuOpen = !this.isViewModeMenuOpen;
  }

  public selectViewMode(mode: 'day' | '3days' | 'week'): void {
    this.changeViewMode(mode);
    this.isViewModeMenuOpen = false;
    this.viewModeTrigger?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  public closeMenuOnOutsideClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.isViewModeMenuOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  public closeMenuOnEscape(): void {
    if (this.isViewModeMenuOpen) {
      this.isViewModeMenuOpen = false;
      this.viewModeTrigger?.nativeElement.focus();
    }
  }
}
