import { Component, Input, Output, EventEmitter } from '@angular/core';
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

  public changeViewMode(mode: 'day' | '3days' | 'week'): void {
    this.viewModeChanged.emit(mode);
  }
}
