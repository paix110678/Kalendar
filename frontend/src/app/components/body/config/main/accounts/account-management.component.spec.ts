import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../../../services/api.service';
import { AccountInvitationRecord, AuthAccount, AuthService } from '../../../../../services/auth.service';
import { ToastService } from '../../../../../services/toast.service';
import { User } from '../../../../../services/calendar.service';
import { AdminEditorActions } from '../../action-footer/action-footer.component';
import { AccountManagementComponent } from './account-management.component';

describe('AccountManagementComponent', () => {
  let fixture: ComponentFixture<AccountManagementComponent>;
  let authService: {
    currentAccount: AuthAccount | null;
    getAccounts: ReturnType<typeof vi.fn>;
    getInvitations: ReturnType<typeof vi.fn>;
    inviteAccount: ReturnType<typeof vi.fn>;
    updateAccount: ReturnType<typeof vi.fn>;
  };
  let apiService: {
    getSystemTables: ReturnType<typeof vi.fn>;
    getSystemTableData: ReturnType<typeof vi.fn>;
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
    linkedAccount.role = 'adult';
    linkedAccount.profile_id = 1;
    linkedAccount.is_active = false;
    authService = {
      currentAccount: null,
      getAccounts: vi.fn(() => of([{ ...linkedAccount }])),
      getInvitations: vi.fn(() => of([pendingInvitation])),
      inviteAccount: vi.fn(() => of({ message: 'Einladung gesendet.' })),
      updateAccount: vi.fn(() => of({ message: 'Konto aktualisiert.' })),
    };
    apiService = {
      getSystemTables: vi.fn(() => of(['accounts', 'roles'])),
      getSystemTableData: vi.fn(() => of({
        columns: ['role'],
        rows: [{ role: 'admin' }],
        total_rows: 1,
        truncated: false,
      })),
    };
    await TestBed.configureTestingModule({
      imports: [AccountManagementComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ApiService, useValue: apiService },
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
    const account = fixture.componentInstance.accounts[0];
    account.role = 'child';
    fixture.componentInstance.onRoleChanged(account);

    expect(actions).toMatchObject({ dirty: true, canDelete: true });
    expect(fixture.nativeElement.textContent).not.toContain('Änderungen speichern');
    expect(fixture.nativeElement.textContent).not.toContain('Login entfernen');
  });

  it('allows admins to cancel or save account reactivation', async () => {
    const component = fixture.componentInstance;
    const actionsChange = vi.fn();
    component.editorActionsChange.subscribe(actionsChange);
    fixture.componentRef.setInput('selectedTreeItemId', 'account:1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.selectedAccountDetails).not.toBeNull();
    const activeCheckbox = fixture.nativeElement.querySelector(
      '.account-active-field input',
    ) as HTMLInputElement;
    expect(activeCheckbox.checked).toBe(false);
    activeCheckbox.click();
    fixture.detectChanges();

    expect(component.selectedAccountDetails?.is_active).toBe(true);
    let actions = actionsChange.mock.lastCall?.[0] as AdminEditorActions;
    expect(actions.dirty).toBe(true);
    actions.cancel();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.selectedAccountDetails?.is_active).toBe(false);
    expect(activeCheckbox.checked).toBe(false);
    expect(authService.updateAccount).not.toHaveBeenCalled();

    activeCheckbox.click();
    actions = actionsChange.mock.lastCall?.[0] as AdminEditorActions;
    actions.save();
    expect(authService.updateAccount).toHaveBeenCalledWith(1, {
      role: 'adult',
      profile_id: 1,
      is_active: true,
    });
  });

  it('does not allow the current admin to deactivate their own account', async () => {
    authService.currentAccount = linkedAccount;
    fixture.componentRef.setInput('selectedTreeItemId', 'account:1');
    fixture.detectChanges();
    await fixture.whenStable();

    const activeCheckbox = fixture.nativeElement.querySelector(
      '.account-active-field input',
    ) as HTMLInputElement;
    expect(activeCheckbox.disabled).toBe(true);
  });

  it('explains why an account without a family profile cannot be saved', () => {
    fixture.componentRef.setInput('selectedTreeItemId', 'account:1');
    fixture.detectChanges();
    const account = fixture.componentInstance.accounts[0];
    account.profile_id = null;
    fixture.componentInstance.save(account);
    fixture.detectChanges();

    expect(authService.updateAccount).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Bitte wähle ein passendes Familienprofil');
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

  it('loads a selected system table in read-only form', () => {
    const tableButtons = fixture.nativeElement.querySelectorAll(
      '.system-table-list button',
    ) as NodeListOf<HTMLButtonElement>;
    const tableButton = Array.from(tableButtons)
      .find((button) => button.textContent?.trim() === 'accounts');
    expect(tableButton).toBeDefined();
    tableButton?.click();
    fixture.detectChanges();

    expect(apiService.getSystemTableData).toHaveBeenCalledWith('accounts');
    expect(fixture.nativeElement.querySelector('.system-table-data').textContent).toContain('admin');
    expect(fixture.nativeElement.querySelector('.system-table-data button')).toBeNull();
  });
});
