import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiService,
  FamilyTask,
  FamilyTaskPayload,
  FamilyTaskSeriesPayload,
} from '../../../../../services/api.service';
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
  const recurringTask: FamilyTask = {
    ...parent,
    id: 21,
    title: 'Lesen',
    points: 3,
    series_id: 8,
    repeat_weekdays: ['Dienstag'],
    series_start_date: '2026-11-24',
    series_end_date: null,
  };
  const createFamilyTaskSeries = vi.fn((_payload: FamilyTaskSeriesPayload) => of({
    series_id: 8,
    tasks: [recurringTask],
  }));
  const updateFamilyTask = vi.fn();
  const deleteFamilyTask = vi.fn();
  const toastShow = vi.fn();

  beforeEach(async () => {
    createFamilyTask.mockClear();
    createFamilyTaskSeries.mockClear();
    updateFamilyTask.mockClear();
    deleteFamilyTask.mockClear();
    toastShow.mockClear();

    await TestBed.configureTestingModule({
      imports: [FamilyTasksComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            createFamilyTask,
            createFamilyTaskSeries,
            updateFamilyTask,
            deleteFamilyTask,
          },
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
    expect(fixture.nativeElement.querySelector('[name="familyTaskMember"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[name="familyTaskParent"]')).toBeNull();
  });

  it('creates a subtask only for the selected recurring occurrence', () => {
    fixture.componentRef.setInput('tasks', [recurringTask]);
    fixture.componentRef.setInput('defaultParentId', recurringTask.id);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.title = 'Buch auswählen';
    let saveAction: (() => void) | undefined;
    component.editorActionsChange.subscribe((value) => { saveAction = value.save; });
    component.publishEditorActions();

    expect(fixture.nativeElement.textContent).toContain('Unteraufgabe zu „Lesen“ am 24.11.2026');
    saveAction?.();
    expect(createFamilyTask).toHaveBeenCalledWith({
      title: 'Buch auswählen',
      member_id: member.id,
      due_date: recurringTask.due_date,
      parent_id: recurringTask.id,
      points: 0,
    });
  });

  it('saves tasks for several members one after another', () => {
    const other: User = { ...member, id: 8, name: 'Bea' };
    const saved: FamilyTask[] = [];
    createFamilyTask.mockImplementation((payload: FamilyTaskPayload) => {
      const task = { ...parent, id: 100 + saved.length, title: payload.title, member_id: payload.member_id, parent_id: null };
      saved.push(task);
      return of(task);
    });
    const component = fixture.componentInstance;
    let saveAction: (() => void) | undefined;
    component.editorActionsChange.subscribe((value) => { saveAction = value.save; });
    component.tasksChanged.subscribe((tasks) => fixture.componentRef.setInput('tasks', tasks));
    component.selectedTaskIdChange.subscribe((id) => fixture.componentRef.setInput('selectedTaskId', id));
    fixture.componentRef.setInput('activeUsers', [member, other]);

    for (const [index, target] of [member, other].entries()) {
      fixture.componentRef.setInput('selectedTaskId', null);
      fixture.componentRef.setInput('defaultParentId', null);
      fixture.componentRef.setInput('defaultMemberId', target.id);
      fixture.detectChanges();
      component.title = `Aufgabe ${index}`;
      component.publishEditorActions();
      saveAction?.();
      fixture.detectChanges();
    }

    expect(saved.map((task) => task.member_id)).toEqual([member.id, other.id]);
    expect(component.errorMessage).toBe('');
  });

  it('does not silently select the first member without a context', () => {
    fixture.componentRef.setInput('defaultMemberId', null);
    fixture.componentRef.setInput('defaultParentId', null);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.title = 'Lesen';
    let saveAction: (() => void) | undefined;
    component.editorActionsChange.subscribe((value) => { saveAction = value.save; });
    component.publishEditorActions();

    saveAction?.();
    expect(createFamilyTask).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(false, expect.stringContaining('Plus beim Familienmitglied'));
  });

  it('creates a weekly recurrence and publishes its calendar occurrence', () => {
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('defaultParentId', null);
    fixture.componentRef.setInput('selectedTaskId', null);
    fixture.detectChanges();
    const savedTasks: FamilyTask[][] = [];
    component.tasksChanged.subscribe((tasks) => savedTasks.push(tasks));
    component.title = 'Lesen';
    component.memberId = member.id;
    component.dueDate = '2026-11-24';
    component.repeatEnabled = true;
    component.repeatWeekdays = ['Dienstag'];
    component.points = 3;
    let saveAction: (() => void) | undefined;
    component.editorActionsChange.subscribe((value) => { saveAction = value.save; });
    component.publishEditorActions();

    saveAction?.();

    expect(createFamilyTaskSeries).toHaveBeenCalledWith({
      title: 'Lesen',
      member_id: member.id,
      start_date: '2026-11-24',
      repeat_weekdays: ['Dienstag'],
      end_date: null,
      points: 3,
    });
    expect(savedTasks).toEqual([[recurringTask]]);
    expect(component.editingTaskId).toBe(recurringTask.id);
  });
});
