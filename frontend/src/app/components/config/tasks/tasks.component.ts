import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService, TaskDefinition, TaskPayload } from '../../../services/api.service';
import { Category, User } from '../../../services/calendar.service';
import { ToastService } from '../../../services/toast.service';
import { AdminEditorActions } from '../admin-editor-actions';
import { ColorPickerComponent } from '../color-picker/color-picker.component';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule, ColorPickerComponent],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.css',
})
export class TasksComponent implements OnChanges {
  @Input() activeUsers: User[] = [];
  @Input() categories: Category[] = [];
  @Input() tasks: TaskDefinition[] = [];
  @Input() selectedTaskId: number | null = null;
  @Input() defaultCategoryId: number | null = null;
  @Output() tasksChanged = new EventEmitter<TaskDefinition[]>();
  @Output() selectedTaskIdChange = new EventEmitter<number | null>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly toastService = inject(ToastService);
  title = '';
  color = '#228be6';
  categoryId: number | null = null;
  memberIds: number[] = [];
  editingTaskId: number | null = null;
  loading = false;
  errorMessage = '';
  private savedTask: TaskDefinition | null = null;

  constructor(private readonly apiService: ApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedTaskId'] || changes['defaultCategoryId']) this.loadSelectedTask();
  }

  private loadSelectedTask(): void {
    const task = this.tasks.find((item) => item.id === this.selectedTaskId);
    this.editingTaskId = task?.id ?? null;
    this.savedTask = task ? { ...task, member_ids: [...task.member_ids] } : null;
    this.title = task?.title ?? '';
    this.color = task?.color ?? '#228be6';
    this.categoryId = task?.category_id ?? this.defaultCategoryId;
    this.memberIds = task ? [...task.member_ids] : [];
    this.errorMessage = '';
    this.publishEditorActions();
  }

  toggleMember(memberId: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.memberIds = checked
      ? [...this.memberIds, memberId]
      : this.memberIds.filter((id) => id !== memberId);
    this.publishEditorActions();
  }

  publishEditorActions(): void {
    this.editorActionsChange.emit({
      dirty: this.isDirty,
      showSave: this.editingTaskId === null || this.isDirty,
      canDelete: this.editingTaskId !== null,
      busy: this.loading,
      saveLabel: this.editingTaskId === null ? 'Task hinzufügen' : 'Speichern',
      save: () => this.saveTask(),
      cancel: () => this.cancelChanges(),
      delete: () => this.deleteTask(),
    });
  }

  private get isDirty(): boolean {
    if (this.editingTaskId === null) {
      return this.title.trim() !== '' || this.categoryId !== null || this.memberIds.length > 0
        || this.color !== '#228be6';
    }
    return !this.savedTask
      || this.title !== this.savedTask.title
      || this.color !== this.savedTask.color
      || this.categoryId !== this.savedTask.category_id
      || JSON.stringify([...this.memberIds].sort((a, b) => a - b))
        !== JSON.stringify([...this.savedTask.member_ids].sort((a, b) => a - b));
  }

  private saveTask(): void {
    const title = this.title.trim();
    if (!title) {
      this.toastService.show(false, 'Bitte einen Titel für den Task eingeben.');
      return;
    }
    if (this.categoryId === null || !this.categories.some((category) => category.id === this.categoryId)) {
      this.toastService.show(false, 'Bitte eine gültige Kategorie auswählen.');
      return;
    }

    const payload: TaskPayload = {
      title,
      color: this.color,
      category_id: this.categoryId,
      member_ids: [...this.memberIds],
    };
    this.loading = true;
    this.errorMessage = '';
    this.publishEditorActions();
    const request = this.editingTaskId === null
      ? this.apiService.createTask(payload)
      : this.apiService.updateTask(this.editingTaskId, payload);
    request.subscribe({
      next: (task) => {
        this.loading = false;
        this.editingTaskId = task.id;
        this.savedTask = { ...task, member_ids: [...task.member_ids] };
        this.title = task.title;
        this.color = task.color;
        this.categoryId = task.category_id;
        this.memberIds = [...task.member_ids];
        this.tasksChanged.emit(this.replaceTask(task));
        this.selectedTaskIdChange.emit(task.id);
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        this.loading = false;
        this.errorMessage = this.describeError(error, 'Task konnte nicht gespeichert werden.');
        this.publishEditorActions();
      },
    });
  }

  cancelChanges(): void {
    if (this.editingTaskId === null) {
      this.title = '';
      this.color = '#228be6';
      this.categoryId = this.defaultCategoryId;
      this.memberIds = [];
      this.errorMessage = '';
      this.publishEditorActions();
      return;
    }
    if (this.savedTask) {
      this.title = this.savedTask.title;
      this.color = this.savedTask.color;
      this.categoryId = this.savedTask.category_id;
      this.memberIds = [...this.savedTask.member_ids];
    }
    this.errorMessage = '';
    this.publishEditorActions();
  }

  private deleteTask(): void {
    if (this.editingTaskId === null || !this.savedTask) return;
    if (!confirm(`Task „${this.savedTask.title}“ wirklich löschen?`)) return;
    const taskId = this.editingTaskId;
    this.loading = true;
    this.errorMessage = '';
    this.publishEditorActions();
    this.apiService.deleteTask(taskId).subscribe({
      next: () => {
        this.loading = false;
        this.tasksChanged.emit(this.tasks.filter((task) => task.id !== taskId));
        this.selectedTaskIdChange.emit(null);
      },
      error: (error: unknown) => {
        this.loading = false;
        this.errorMessage = this.describeError(error, 'Task konnte nicht gelöscht werden.');
        this.publishEditorActions();
      },
    });
  }

  private replaceTask(task: TaskDefinition): TaskDefinition[] {
    const updated = this.tasks.some((item) => item.id === task.id)
      ? this.tasks.map((item) => item.id === task.id ? task : item)
      : [...this.tasks, task];
    return updated.sort((left, right) => left.title.localeCompare(right.title, 'de'));
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.detail === 'string') {
      return error.error.detail;
    }
    return fallback;
  }
}
