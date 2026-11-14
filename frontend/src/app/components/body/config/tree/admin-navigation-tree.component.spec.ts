import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
});
