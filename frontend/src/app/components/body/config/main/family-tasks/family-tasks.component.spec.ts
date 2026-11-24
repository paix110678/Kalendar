import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, FamilyTask, FamilyTaskPayload } from '../../../../../services/api.service';
import { User } from '../../../../../services/calendar.service';
import { ToastService } from '../../../../../services/toast.service';
import { FamilyTasksComponent } from './family-tasks.component';

describe('FamilyTasksComponent', () => {
  let fixture: ComponentFixture<FamilyTasksComponent>;
  const member: User = {
    id: 7,
    name: 'Alex',
    role: 'child_10',
    current_points: 0,
    status_school: 'GREEN',
    status_sport: 'BASE',
    color_code: '#228be6',
    state_code: null,
    assigned_plan_id: null,
    is_active: true,
  };
  const parent: FamilyTask = {
    id: 12,
    title: 'Zimmer aufräumen',
    member_id: member.id,
    due_date: '2026-11-24',
    parent_id: null,
    points: 5,
    completed: false,
    points_awarded: false,
  };
  const child: FamilyTask = {
    id: 13,
    title: 'Spielzeug wegräumen',
    member_id: member.id,
    due_date: parent.due_date,
    parent_id: parent.id,
    points: 2,
    completed: false,
    points_awarded: false,
  };
  const createFamilyTask = vi.fn((_payload: FamilyTaskPayload) => of(child));
  const updateFamilyTask = vi.fn();
  const deleteFamilyTask = vi.fn();
  const toastShow = vi.fn();

  beforeEach(async () => {
    createFamilyTask.mockClear();
    updateFamilyTask.mockClear();
    deleteFamilyTask.mockClear();
    toastShow.mockClear();

    await TestBed.configureTestingModule({
      imports: [FamilyTasksComponent],
      providers: [
        {
          provide: ApiService,
          useValue: { createFamilyTask, updateFamilyTask, deleteFamilyTask },
        },
        { provide: ToastService, useValue: { show: toastShow } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FamilyTasksComponent);
    fixture.componentRef.setInput('activeUsers', [member]);
    fixture.componentRef.setInput('tasks', [parent]);
    fixture.componentRef.setInput('defaultMemberId', member.id);
    fixture.componentRef.setInput('defaultParentId', parent.id);
    fixture.detectChanges();
  });

  it('creates a subtask for the selected parent and publishes the updated task list', () => {
    const component = fixture.componentInstance;
    const savedTasks: FamilyTask[][] = [];
    const selectedTaskIds: Array<number | null> = [];
    component.tasksChanged.subscribe((tasks) => savedTasks.push(tasks));
    component.selectedTaskIdChange.subscribe((id) => selectedTaskIds.push(id));
    component.title = child.title;
    const actions = component.editorActionsChange;
    let saveAction: (() => void) | undefined;
    actions.subscribe((value) => { saveAction = value.save; });
    component.publishEditorActions();

    saveAction?.();

    expect(createFamilyTask).toHaveBeenCalledWith({
      title: child.title,
      member_id: member.id,
      due_date: parent.due_date,
      parent_id: parent.id,
      points: 0,
    });
    expect(savedTasks).toEqual([[parent, child]]);
    expect(selectedTaskIds).toEqual([child.id]);
    expect(component.editingTaskId).toBe(child.id);
  });
});
