export interface AdminEditorActions {
  dirty: boolean;
  canDelete: boolean;
  busy?: boolean;
  showSave?: boolean;
  showSaveLabel?: boolean;
  hideSave?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  save(): void;
  cancel(): void;
  delete?(): void;
}
