import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface AdminEditorActions {
  dirty: boolean;
  canDelete: boolean;
  busy?: boolean;
  showSave?: boolean;
  showSaveLabel?: boolean;
  hideSave?: boolean;
  hideCancel?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  save(): void;
  cancel(): void;
  delete?(): void;
}

@Component({
  selector: 'app-action-footer',
  standalone: true,
  templateUrl: './action-footer.component.html',
  styleUrl: './action-footer.component.css',
})
export class ActionFooterComponent {
  @Input() actions: AdminEditorActions | null = null;
  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
}
