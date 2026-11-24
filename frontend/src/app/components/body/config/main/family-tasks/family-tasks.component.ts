import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, FamilyTask, FamilyTaskPayload } from '../../../../../services/api.service';
import { User } from '../../../../../services/calendar.service';
import { ToastService } from '../../../../../services/toast.service';
import { AdminEditorActions } from '../../action-footer/action-footer.component';

@Component({
  selector: 'app-family-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './family-tasks.component.html',
  styleUrl: './family-tasks.component.css',
})
export class FamilyTasksComponent implements OnChanges {
  @Input() activeUsers: User[] = [];
  @Input() tasks: FamilyTask[] = [];
  @Input() selectedTaskId: number | null = null;
  @Input() defaultMemberId: number | null = null;
  @Input() defaultParentId: number | null = null;

  @Output() tasksChanged = new EventEmitter<FamilyTask[]>();
  @Output() selectedTaskIdChange = new EventEmitter<number | null>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();

  private readonly apiService = inject(ApiService);
  private readonly toastService = inject(ToastService);
  title = '';
  memberId: number | null = null;
  dueDate = '';
  parentId: number | null = null;
  points: number | null = null;
  saving = false;
  errorMessage = '';
  editingTaskId: number | null = null;
  savedTask: FamilyTask | null = null;
  private savedSnapshot = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['selectedTaskId']
      || changes['defaultMemberId']
      || changes['defaultParentId']
      || (changes['tasks'] && !this.isDirty)
      || (changes['activeUsers'] && !this.isDirty)
    ) {
      this.loadSelectedTask();
    }
  }

  private get isDirty(): boolean {
    return this.formSnapshot() !== this.savedSnapshot;
  }

  private loadSelectedTask(): void {
    const task = this.tasks.find((item) => item.id === this.selectedTaskId);
    const parent = this.tasks.find((item) => item.id === (task?.parent_id ?? this.defaultParentId));
    this.editingTaskId = task?.id ?? null;
    this.savedTask = task ? { ...task } : null;
    this.title = task?.title ?? '';
    this.memberId = task?.member_id ?? parent?.member_id ?? this.defaultMemberId ?? this.activeUsers[0]?.id ?? null;
    this.dueDate = task?.due_date ?? parent?.due_date ?? this.today();
    this.parentId = task?.parent_id ?? this.defaultParentId;
    this.points = task?.points || null;
    this.errorMessage = '';
    this.savedSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  get availableParents(): FamilyTask[] {
    return this.tasks.filter((task) =>
      task.parent_id === null
      && task.id !== this.editingTaskId
      && task.member_id === this.memberId
      && task.due_date === this.dueDate,
    );
  }

  get hasSubtasks(): boolean {
    return this.editingTaskId !== null
      && this.tasks.some((task) => task.parent_id === this.editingTaskId);
  }

  onParentChange(parentId: number | null): void {
    this.parentId = parentId;
    const parent = this.tasks.find((task) => task.id === parentId);
    if (parent) {
      this.memberId = parent.member_id;
      this.dueDate = parent.due_date;
    }
    this.publishEditorActions();
  }

  publishEditorActions(): void {
    const dirty = this.formSnapshot() !== this.savedSnapshot;
    this.editorActionsChange.emit({
      dirty,
      showSave: this.editingTaskId === null || dirty,
      canDelete: this.editingTaskId !== null,
      busy: this.saving,
      saveLabel: this.editingTaskId === null ? 'Aufgabe hinzufügen' : 'Speichern',
      save: () => this.saveTask(),
      cancel: () => this.cancelChanges(),
      delete: () => this.deleteTask(),
    });
  }

  cancelChanges(): void {
    if (this.savedTask) {
      this.title = this.savedTask.title;
      this.memberId = this.savedTask.member_id;
      this.dueDate = this.savedTask.due_date;
      this.parentId = this.savedTask.parent_id;
      this.points = this.savedTask.points || null;
    } else {
      this.title = '';
      this.memberId = this.defaultMemberId ?? this.activeUsers[0]?.id ?? null;
      this.dueDate = this.today();
      this.parentId = this.defaultParentId;
      this.points = null;
    }
    this.errorMessage = '';
    this.publishEditorActions();
  }

  private saveTask(): void {
    const title = this.title.trim();
    if (!title) {
      this.toastService.show(false, 'Bitte einen Aufgabentitel eingeben.');
      return;
    }
    if (this.memberId === null || !this.activeUsers.some((user) => user.id === this.memberId)) {
      this.toastService.show(false, 'Bitte ein Familienmitglied auswählen.');
      return;
    }
    if (!this.isValidDate(this.dueDate)) {
      this.toastService.show(false, 'Bitte einen gültigen Fälligkeitstag auswählen.');
      return;
    }
    if (this.points !== null && (!Number.isInteger(this.points) || this.points < 0 || this.points > 10000)) {
      this.toastService.show(false, 'Punkte müssen eine ganze Zahl zwischen 0 und 10.000 sein.');
      return;
    }

    const payload: FamilyTaskPayload = {
      title,
      member_id: this.memberId,
      due_date: this.dueDate,
      parent_id: this.parentId,
      points: this.points ?? 0,
    };
    this.saving = true;
    this.errorMessage = '';
    this.publishEditorActions();
    const request = this.editingTaskId === null
      ? this.apiService.createFamilyTask(payload)
      : this.apiService.updateFamilyTask(this.editingTaskId, payload);
    request.subscribe({
      next: (task) => {
        this.saving = false;
        this.editingTaskId = task.id;
        this.savedTask = { ...task };
        this.title = task.title;
        this.memberId = task.member_id;
        this.dueDate = task.due_date;
        this.parentId = task.parent_id;
        this.points = task.points || null;
        this.savedSnapshot = this.formSnapshot();
        this.tasksChanged.emit(this.replaceTask(task));
        this.selectedTaskIdChange.emit(task.id);
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.errorMessage = this.describeError(error, 'Aufgabe konnte nicht gespeichert werden.');
        this.publishEditorActions();
      },
    });
  }

  private deleteTask(): void {
    const task = this.savedTask;
    if (this.editingTaskId === null || !task) return;
    if (!confirm(`Aufgabe „${task.title}“ wirklich löschen?`)) return;
    const taskId = this.editingTaskId;
    this.saving = true;
    this.errorMessage = '';
    this.publishEditorActions();
    this.apiService.deleteFamilyTask(taskId).subscribe({
      next: () => {
        this.saving = false;
        this.tasksChanged.emit(this.tasks.filter((item) =>
          item.id !== taskId && item.parent_id !== taskId,
        ));
        this.editingTaskId = null;
        this.savedTask = null;
        this.title = '';
        this.memberId = this.memberId ?? this.defaultMemberId ?? this.activeUsers[0]?.id ?? null;
        this.dueDate = this.today();
        this.parentId = this.defaultParentId;
        this.points = null;
        this.savedSnapshot = this.formSnapshot();
        this.selectedTaskIdChange.emit(null);
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.errorMessage = this.describeError(error, 'Aufgabe konnte nicht gelöscht werden.');
        this.publishEditorActions();
      },
    });
  }

  private replaceTask(task: FamilyTask): FamilyTask[] {
    const updated = this.tasks.some((item) => item.id === task.id)
      ? this.tasks.map((item) => item.id === task.id ? task : item)
      : [...this.tasks, task];
    return updated.sort((left, right) =>
      left.due_date.localeCompare(right.due_date)
      || left.member_id - right.member_id
      || (left.parent_id ?? 0) - (right.parent_id ?? 0)
      || left.id - right.id,
    );
  }

  private formSnapshot(): string {
    return JSON.stringify([this.title, this.memberId, this.dueDate, this.parentId, this.points]);
  }

  private isValidDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, yearText, monthText, dayText] = match;
    const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
    return date.getFullYear() === Number(yearText)
      && date.getMonth() === Number(monthText) - 1
      && date.getDate() === Number(dayText);
  }

  private today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private describeError(error: unknown, fallback: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.detail === 'string'
      ? error.error.detail
      : fallback;
  }
}
