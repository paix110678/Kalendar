import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FamilyTask,
  FamilyTaskComment,
} from '../../../../../services/api.service';

@Component({
  selector: 'app-task-comments-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './task-comments-dialog.component.html',
  styleUrl: './task-comments-dialog.component.css',
})
export class TaskCommentsDialogComponent {
  @Input({ required: true }) task!: FamilyTask;
  @Input() tasks: FamilyTask[] = [];

  @Output() tasksChanged = new EventEmitter<FamilyTask[]>();
  @Output() close = new EventEmitter<void>();

  private readonly apiService = inject(ApiService);
  commentText = '';
  editingCommentId: number | null = null;
  saving = false;
  errorMessage = '';

  get comments(): FamilyTaskComment[] {
    return this.task.comments ?? [];
  }

  saveComment(): void {
    const text = this.commentText.trim();
    if (!text || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    const request = this.editingCommentId === null
      ? this.apiService.createFamilyTaskComment(this.task.id, text)
      : this.apiService.updateFamilyTaskComment(
        this.task.id,
        this.editingCommentId,
        text,
      );
    request.subscribe({
      next: (comment) => {
        const comments = this.editingCommentId === null
          ? [...this.comments, comment]
          : this.comments.map((item) => item.id === comment.id ? comment : item);
        this.publishComments(comments);
        this.resetEditor();
      },
      error: (error: unknown) => this.showError(error, 'Kommentar konnte nicht gespeichert werden.'),
    });
  }

  editComment(comment: FamilyTaskComment): void {
    if (!comment.can_edit || this.saving) return;
    this.editingCommentId = comment.id;
    this.commentText = comment.text;
    this.errorMessage = '';
  }

  cancelEdit(): void {
    this.resetEditor();
  }

  deleteComment(comment: FamilyTaskComment): void {
    if (!comment.can_edit || this.saving) return;
    if (!confirm('Diesen Kommentar wirklich löschen?')) return;
    this.saving = true;
    this.errorMessage = '';
    this.apiService.deleteFamilyTaskComment(this.task.id, comment.id).subscribe({
      next: () => {
        this.publishComments(this.comments.filter((item) => item.id !== comment.id));
        if (this.editingCommentId === comment.id) this.resetEditor();
        else this.saving = false;
      },
      error: (error: unknown) => this.showError(error, 'Kommentar konnte nicht gelöscht werden.'),
    });
  }

  formatTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
  }

  private publishComments(comments: FamilyTaskComment[]): void {
    this.tasksChanged.emit(this.tasks.map((task) =>
      task.id === this.task.id ? { ...task, comments } : task,
    ));
  }

  private resetEditor(): void {
    this.commentText = '';
    this.editingCommentId = null;
    this.saving = false;
    this.errorMessage = '';
  }

  private showError(error: unknown, fallback: string): void {
    this.saving = false;
    this.errorMessage = error instanceof HttpErrorResponse
      && typeof error.error?.detail === 'string'
      ? error.error.detail
      : fallback;
  }
}
