export interface AdminEditorActions {
  dirty: boolean;
  canDelete: boolean;
  busy?: boolean;
  showSave?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  save(): void;
  cancel(): void;
  delete?(): void;
}
