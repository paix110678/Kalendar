import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FamilyTask } from '../../../../services/api.service';
import { User } from '../../../../services/calendar.service';
import { AccountInvitationRecord, AuthAccount } from '../../../../services/auth.service';
import { AdminNavigationTreeComponent } from './admin-navigation-tree.component';

describe('AdminNavigationTreeComponent account entries', () => {
  let fixture: ComponentFixture<AdminNavigationTreeComponent>;

  const account: AuthAccount = {
    id: 12,
    family_id: 'family',
    email: 'account@example.invalid',
    display_name: 'Alex Beispiel',
    role: 'adult',
    profile_id: 7,
    profile_name: 'Alex',
    email_verified: true,
    is_active: true,
  };
  const invitation: AccountInvitationRecord = {
    id: 'invite-12',
    email: 'invited@example.invalid',
    role: 'child',
    profile_id: 9,
    profile_name: 'Sam',
    created_at: '2026-11-14T10:00:00Z',
    expires_at: '2026-11-21T10:00:00Z',
    status: 'pending',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminNavigationTreeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminNavigationTreeComponent);
    fixture.componentRef.setInput('activeTab', 'accounts');
    fixture.componentRef.setInput('accounts', [account]);
    fixture.componentRef.setInput('invitations', [invitation]);
    fixture.detectChanges();
  });

  it('lists account and pending invitation entries and emits selection actions', () => {
    const actions: Array<{ type: string; id?: number | string | null }> = [];
    fixture.componentInstance.action.subscribe((action) => actions.push(action));

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent)).toEqual([
      '●Alex Beispiel · account@example.invalid',
      '✉invited@example.invalid · Einladung offen',
    ]);

    buttons[0].click();
    buttons[1].click();
    expect(actions).toEqual([
      { type: 'account', id: 12, categoryId: undefined },
      { type: 'invitation', id: 'invite-12', categoryId: undefined },
    ]);
  });

  it('does not show invitations that are no longer pending', () => {
    fixture.componentRef.setInput('invitations', [{ ...invitation, status: 'expired' }]);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain(account.email);
  });

  it('groups open family tasks by member and emits actions to add, list and select tasks', () => {
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
    const tasks: FamilyTask[] = [
      {
        id: 12,
        title: 'Ranzen packen',
        member_id: member.id,
        due_date: '2026-11-24',
        parent_id: null,
        points: 2,
        completed: false,
        points_awarded: false,
      },
      {
        id: 13,
        title: 'Hausaufgaben',
        member_id: member.id,
        due_date: '2026-11-24',
        parent_id: 12,
        points: 0,
        completed: true,
        points_awarded: false,
      },
    ];
    fixture.componentRef.setInput('activeTab', 'familyTasks');
    fixture.componentRef.setInput('activeUsers', [member]);
    fixture.componentRef.setInput('familyTasks', tasks);
    fixture.detectChanges();
    const actions: Array<{ type: string; id?: number | string | null }> = [];
    fixture.componentInstance.action.subscribe((action) => actions.push(action));

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.family-task-member')).toHaveLength(1);
    expect(Array.from(element.querySelectorAll('.family-task-item')).map((item) =>
      item.textContent?.replace(/\s+/g, ' ').trim(),
    )).toEqual(['○ Ranzen packen 24.11. · 2 Punkte']);
    expect(element.querySelector('.family-subtask-add')).toBeNull();
    expect(element.querySelector('.family-subtask-item')).toBeNull();

    const addTask = element.querySelector('.family-task-add') as HTMLButtonElement;
    const addSubtask = element.querySelector('.family-task-subtask-plus') as HTMLButtonElement;
    const listButton = element.querySelector('.family-task-list-button') as HTMLButtonElement;
    const taskButton = element.querySelector('.family-task-item') as HTMLButtonElement;
    addTask.click();
    addSubtask.click();
    listButton.click();
    taskButton.click();

    expect(actions.map(({ type, id }) => [type, id])).toEqual([
      ['newFamilyTask', member.id],
      ['newFamilySubtask', tasks[0].id],
      ['familyTaskList', member.id],
      ['familyTask', tasks[0].id],
    ]);
  });
});
