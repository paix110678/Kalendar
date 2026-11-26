import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FamilyTask,
  FamilyTaskPayload,
  FamilyTaskSeriesPayload,
  FamilyTaskSeriesResult,
} from '../../../../../services/api.service';
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
  readonly weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

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
  repeatEnabled = false;
  repeatWeekdays: string[] = [];
  repeatEndDate = '';
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
    this.memberId = task?.member_id ?? parent?.member_id ?? this.defaultMemberId ?? null;
    this.dueDate = task?.due_date ?? parent?.due_date ?? this.today();
    this.parentId = task?.parent_id ?? this.defaultParentId;
    this.points = task?.points || null;
    this.repeatEnabled = !!task?.repeat_weekdays?.length;
    this.repeatWeekdays = task?.repeat_weekdays ?? [this.weekdayForDate(this.dueDate)];
    this.repeatEndDate = task?.series_end_date ?? '';
    this.errorMessage = '';
    this.savedSnapshot = this.formSnapshot();
    this.publishEditorActions();
  }

  get memberName(): string {
    return this.activeUsers.find((user) => user.id === this.memberId)?.name ?? 'unbekanntes Familienmitglied';
  }

  get parentTask(): FamilyTask | undefined {
    return this.tasks.find((task) => task.id === this.parentId);
  }

  setRepeatEnabled(enabled: boolean): void {
    if (this.savedTask?.series_id != null || this.parentId !== null) return;
    this.repeatEnabled = enabled;
    if (enabled && this.repeatWeekdays.length === 0) {
      this.repeatWeekdays = [this.weekdayForDate(this.dueDate)];
    }
    this.publishEditorActions();
  }

  setRepeatWeekday(day: string, checked: boolean): void {
    this.repeatWeekdays = checked
      ? [...new Set([...this.repeatWeekdays, day])].sort(
        (left, right) => this.weekdays.indexOf(left) - this.weekdays.indexOf(right),
      )
      : this.repeatWeekdays.filter((selected) => selected !== day);
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
    this.loadSelectedTask();
  }

  private saveTask(): void {
    const title = this.title.trim();
    if (!title) {
      this.toastService.show(false, 'Bitte einen Aufgabentitel eingeben.');
      return;
    }
    const member = this.activeUsers.find((user) => user.id === this.memberId);
    if (!member) {
      this.toastService.show(false, 'Bitte die Aufgabe über das Plus beim Familienmitglied hinzufügen.');
      return;
    }
    if (!member.is_active) {
      this.toastService.show(false, 'Dieses Familienmitglied ist inaktiv. Aktiviere es unter Einstellungen → Mitglieder, um Aufgaben zu speichern.');
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

    if (this.repeatEnabled) {
      if (this.parentId !== null) {
        this.toastService.show(false, 'Unteraufgaben können nicht wiederholt werden.');
        return;
      }
      if (this.repeatWeekdays.length === 0) {
        this.toastService.show(false, 'Bitte mindestens einen Wochentag auswählen.');
        return;
      }
      if (this.repeatEndDate && !this.isValidDate(this.repeatEndDate)) {
        this.toastService.show(false, 'Bitte ein gültiges Enddatum auswählen.');
        return;
      }
      if (this.repeatEndDate && this.repeatEndDate < this.dueDate) {
        this.toastService.show(false, 'Das Enddatum muss am oder nach dem Start liegen.');
        return;
      }
      if (
        this.savedTask?.series_id == null
        && this.editingTaskId !== null
        && !this.repeatWeekdays.includes(this.weekdayForDate(this.dueDate))
      ) {
        this.toastService.show(false, 'Der Starttag muss zu einem ausgewählten Wochentag passen.');
        return;
      }
      this.saveSeries(title);
      return;
    }

    if (this.savedTask?.series_id != null) {
      this.toastService.show(false, 'Bitte lege ein Enddatum fest, um die Wiederholung zu beenden.');
      return;
    }

    const payload: FamilyTaskPayload = {
      title,
      member_id: member.id,
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

  private saveSeries(title: string): void {
    const payload: FamilyTaskSeriesPayload = {
      title,
      member_id: this.memberId!,
      start_date: this.dueDate,
      repeat_weekdays: this.repeatWeekdays,
      end_date: this.repeatEndDate || null,
      points: this.points ?? 0,
      ...(this.savedTask?.series_id == null && this.editingTaskId !== null
        ? { existing_task_id: this.editingTaskId }
        : {}),
    };
    const request = this.savedTask?.series_id != null
      ? this.apiService.updateFamilyTaskSeries(this.savedTask.series_id, payload)
      : this.apiService.createFamilyTaskSeries(payload);
    this.saving = true;
    this.errorMessage = '';
    this.publishEditorActions();
    request.subscribe({
      next: (result) => this.finishSavingSeries(result),
      error: (error: unknown) => {
        this.saving = false;
        this.errorMessage = this.describeError(error, 'Wiederholung konnte nicht gespeichert werden.');
        this.publishEditorActions();
      },
    });
  }

  private finishSavingSeries(result: FamilyTaskSeriesResult): void {
    this.saving = false;
    this.tasksChanged.emit(result.tasks);
    const representative = this.getSeriesRepresentative(result.tasks, result.series_id);
    this.editingTaskId = representative?.id ?? null;
    this.savedTask = representative ? { ...representative } : null;
    this.title = representative?.title ?? this.title;
    this.memberId = representative?.member_id ?? this.memberId;
    this.dueDate = representative?.series_start_date ?? this.dueDate;
    this.parentId = null;
    this.points = representative?.points ?? this.points;
    this.repeatEnabled = true;
    this.repeatWeekdays = representative?.repeat_weekdays ?? this.repeatWeekdays;
    this.repeatEndDate = representative
      ? representative.series_end_date ?? ''
      : this.repeatEndDate;
    this.savedSnapshot = this.formSnapshot();
    this.selectedTaskIdChange.emit(representative?.id ?? null);
    this.publishEditorActions();
  }

  private deleteTask(): void {
    const task = this.savedTask;
    if (this.editingTaskId === null || !task) return;
    const recurring = task.series_id != null;
    const prompt = recurring
      ? `Wiederholung „${task.title}“ wirklich löschen? Vergangene Kalendertermine bleiben erhalten.`
      : `Aufgabe „${task.title}“ wirklich löschen?`;
    if (!confirm(prompt)) return;
    const taskId = this.editingTaskId;
    this.saving = true;
    this.errorMessage = '';
    this.publishEditorActions();
    const finishDelete = (tasks: FamilyTask[]) => {
        this.saving = false;
        this.tasksChanged.emit(tasks);
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
    };
    if (recurring) {
      this.apiService.deleteFamilyTaskSeries(task.series_id!).subscribe({
        next: finishDelete,
        error: (error: unknown) => {
          this.saving = false;
          this.errorMessage = this.describeError(error, 'Wiederholung konnte nicht gelöscht werden.');
          this.publishEditorActions();
        },
      });
      return;
    }
    this.apiService.deleteFamilyTask(taskId).subscribe({
      next: () => finishDelete(this.tasks.filter((item) =>
        item.id !== taskId && item.parent_id !== taskId,
      )),
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
    return JSON.stringify([
      this.title,
      this.memberId,
      this.dueDate,
      this.parentId,
      this.points,
      this.repeatEnabled,
      this.repeatWeekdays,
      this.repeatEndDate,
    ]);
  }

  private getSeriesRepresentative(tasks: FamilyTask[], seriesId: number): FamilyTask | undefined {
    const today = this.today();
    return tasks
      .filter((task) => task.series_id === seriesId)
      .sort((left, right) => {
        const leftCurrent = !left.completed && left.due_date >= today;
        const rightCurrent = !right.completed && right.due_date >= today;
        if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
        return left.due_date.localeCompare(right.due_date);
      })[0];
  }

  private weekdayForDate(value: string): string {
    if (!this.isValidDate(value)) return this.weekdays[0];
    const day = new Date(`${value}T00:00:00`).getDay();
    return this.weekdays[day === 0 ? 6 : day - 1];
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
