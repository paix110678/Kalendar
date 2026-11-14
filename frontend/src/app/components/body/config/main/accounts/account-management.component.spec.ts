import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountInvitationRecord, AuthAccount, AuthService } from '../../../../../services/auth.service';
import { ToastService } from '../../../../../services/toast.service';
import { User } from '../../../../../services/calendar.service';
import { AccountManagementComponent } from './account-management.component';

describe('AccountManagementComponent', () => {
  let fixture: ComponentFixture<AccountManagementComponent>;
  let authService: {
    getAccounts: ReturnType<typeof vi.fn>;
    getInvitations: ReturnType<typeof vi.fn>;
    inviteAccount: ReturnType<typeof vi.fn>;
  };

  const profiles: User[] = [
    {
      id: 1,
      name: 'Verknüpft',
      role: 'adult',
      current_points: 0,
      status_school: 'GREEN',
      status_sport: 'BASE',
      color_code: '#228be6',
      state_code: null,
      assigned_plan_id: null,
      is_active: true,
    },
    {
      id: 2,
      name: 'Frei',
      role: 'child_10',
      current_points: 0,
      status_school: 'GREEN',
      status_sport: 'BASE',
      color_code: '#228be6',
      state_code: null,
      assigned_plan_id: null,
      is_active: true,
    },
    {
      id: 3,
      name: 'Inaktiv',
      role: 'child_10',
      current_points: 0,
      status_school: 'GREEN',
      status_sport: 'BASE',
      color_code: '#228be6',
      state_code: null,
      assigned_plan_id: null,
      is_active: false,
    },
  ];

  const linkedAccount: AuthAccount = {
    id: 1,
    family_id: 'family',
    email: 'linked@example.invalid',
    display_name: 'Verknüpft',
    role: 'adult',
    profile_id: 1,
    email_verified: true,
    is_active: false,
  };

  const pendingInvitation: AccountInvitationRecord = {
    id: 'pending-invite',
    email: 'pending@example.invalid',
    role: 'child',
    profile_id: 2,
    profile_name: 'Frei',
    created_at: '2026-11-14T10:00:00Z',
    expires_at: '2026-11-21T10:00:00Z',
    status: 'pending',
  };

  beforeEach(async () => {
    authService = {
      getAccounts: vi.fn(() => of([linkedAccount])),
      getInvitations: vi.fn(() => of([pendingInvitation])),
      inviteAccount: vi.fn(() => of({ message: 'Einladung gesendet.' })),
    };
    await TestBed.configureTestingModule({
      imports: [AccountManagementComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ToastService, useValue: { show: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountManagementComponent);
    fixture.componentRef.setInput('familyProfiles', profiles);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('excludes profiles with an account or pending invitation, regardless of profile activity', () => {
    expect(fixture.componentInstance.inviteProfiles.map((profile) => profile.id)).toEqual([3]);
  });

  it('sends an invitation without a role', () => {
    const component = fixture.componentInstance;
    component.inviteEmail = ' new@example.invalid ';
    component.inviteProfileId = 3;
    component.invite();

    expect(authService.inviteAccount).toHaveBeenCalledWith({
      email: 'new@example.invalid',
      profile_id: 3,
    });
    expect(fixture.nativeElement.querySelector('[name="inviteRole"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[name="active-1"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Deaktiviert');
  });

  it('publishes the selected account actions to the shared footer', () => {
    let actions: { dirty: boolean; canDelete: boolean } | null = null;
    fixture.componentInstance.editorActionsChange.subscribe((value) => {
      actions = value;
    });

    fixture.componentRef.setInput('selectedTreeItemId', 'account:1');
    fixture.detectChanges();
    linkedAccount.role = 'child';
    fixture.componentInstance.onRoleChanged(linkedAccount);

    expect(actions).toMatchObject({ dirty: true, canDelete: true });
    expect(fixture.nativeElement.textContent).not.toContain('Änderungen speichern');
    expect(fixture.nativeElement.textContent).not.toContain('Login entfernen');
  });

  it('offers resend from the shared footer for a selected pending invitation', () => {
    let actions: { showSave?: boolean; saveLabel?: string; canDelete: boolean } | null = null;
    fixture.componentInstance.editorActionsChange.subscribe((value) => {
      actions = value;
    });

    fixture.componentRef.setInput('selectedTreeItemId', 'invitation:pending-invite');
    fixture.detectChanges();

    expect(actions).toMatchObject({
      showSave: true,
      saveLabel: 'Einladung erneut senden',
      canDelete: false,
    });
    expect(fixture.nativeElement.querySelector('[name="inviteEmail"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('pending@example.invalid');
  });
});
