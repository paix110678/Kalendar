import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ApiService, FamilyTask } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { CalendarService } from '../../../services/calendar.service';
import { ToastService } from '../../../services/toast.service';
import { AdminEditorActions } from './action-footer/action-footer.component';
import { ConfigComponent } from './config.component';

describe('ConfigComponent family task navigation', () => {
  it('keeps the editor actions when the same plus is selected again', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    });
    const component = new ConfigComponent(
      TestBed.inject(ApiService), TestBed.inject(CalendarService),
      TestBed.inject(AuthService), TestBed.inject(ToastService),
    );
    const actions: AdminEditorActions = {
      dirty: false, showSave: true, canDelete: false, busy: false,
      saveLabel: 'Aufgabe hinzufügen', save: () => {}, cancel: () => {},
    };
    const parent: FamilyTask = {
      id: 21, title: 'Lesen', member_id: 7, due_date: '2099-01-05',
      parent_id: null, points: 0, completed: false, points_awarded: false,
      series_id: 3,
    };
    component.familyTasks = [parent];

    component.openNewFamilyTask(7);
    component.editorActions = actions;
    component.openNewFamilyTask(7);
    expect(component.editorActions).toBe(actions);

    component.openNewFamilySubtask(parent.id);
    expect(component.editorActions).toBeNull();
    component.editorActions = actions;
    component.openNewFamilySubtask(parent.id);
    expect(component.editorActions).toBe(actions);

    component.openFamilyTaskList(7);
    component.closeFamilyTaskList();
    expect(component.selectedFamilyTaskMemberId).toBeNull();
    expect(component.editorActions).toBeNull();
  });
});
