import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AdminEditorActions } from '../admin-editor-actions';

@Component({
  selector: 'app-editor-actions-footer',
  standalone: true,
  templateUrl: './editor-actions-footer.component.html',
  styleUrl: './editor-actions-footer.component.css',
})
export class EditorActionsFooterComponent {
  @Input() actions: AdminEditorActions | null = null;
  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
}
