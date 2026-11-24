import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiService,
  FamilyTask,
  FamilyTaskComment,
} from '../../../../../services/api.service';
import { TaskCommentsDialogComponent } from './task-comments-dialog.component';

describe('TaskCommentsDialogComponent', () => {
  let fixture: ComponentFixture<TaskCommentsDialogComponent>;
  const task: FamilyTask = {
    id: 8,
    title: 'Ranzen packen',
    member_id: 3,
    due_date: '2026-11-24',
    parent_id: null,
    points: 0,
    completed: false,
    points_awarded: false,
    comments: [],
  };
  const comment: FamilyTaskComment = {
    id: 15,
    text: 'Das Matheheft liegt bereit.',
    createdAt: '2026-11-24T11:00:00+00:00',
    author: 'Alex',
    can_edit: true,
  };
  const createFamilyTaskComment = vi.fn((_taskId: number, _text: string) => of(comment));
  const updateFamilyTaskComment = vi.fn();
  const deleteFamilyTaskComment = vi.fn();

  beforeEach(async () => {
    createFamilyTaskComment.mockClear();
    updateFamilyTaskComment.mockClear();
    deleteFamilyTaskComment.mockClear();

    await TestBed.configureTestingModule({
      imports: [TaskCommentsDialogComponent],
      providers: [{
        provide: ApiService,
        useValue: {
          createFamilyTaskComment,
          updateFamilyTaskComment,
          deleteFamilyTaskComment,
        },
      }],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskCommentsDialogComponent);
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('tasks', [task]);
    fixture.detectChanges();
  });

  it('saves a comment and emits the updated task comments', () => {
    const component = fixture.componentInstance;
    const updates: FamilyTask[][] = [];
    component.tasksChanged.subscribe((tasks) => updates.push(tasks));
    component.commentText = 'Das Matheheft liegt bereit.';

    component.saveComment();

    expect(createFamilyTaskComment).toHaveBeenCalledWith(task.id, comment.text);
    expect(updates).toEqual([[{ ...task, comments: [comment] }]]);
    expect(component.commentText).toBe('');
  });
});
