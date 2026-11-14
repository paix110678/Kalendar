import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AccountInvitationRecord,
  AccountRole,
  AuthAccount,
  AuthService,
} from '../../../../../services/auth.service';
import { ToastService } from '../../../../../services/toast.service';
import { User } from '../../../../../services/calendar.service';
import { AdminEditorActions } from '../../action-footer/action-footer.component';

export interface AccountTreeData {
  accounts: AuthAccount[];
  invitations: AccountInvitationRecord[];
  loading: boolean;
  invitationsLoading: boolean;
  error: string;
}

@Component({
  selector: 'app-account-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account-management.component.html',
  styleUrl: './account-management.component.css',
})
export class AccountManagementComponent implements OnInit, OnChanges {
  @Input() familyProfiles: User[] = [];
  @Input() selectedTreeItemId: string | null = null;
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions | null>();
  @Output() treeDataChange = new EventEmitter<AccountTreeData>();
  @Output() selectedTreeItemChange = new EventEmitter<string | null>();

  accounts: AuthAccount[] = [];
  invitations: AccountInvitationRecord[] = [];
  inviteEmail = '';
  inviteProfileId: number | null = null;
  accountsLoaded = false;
  invitationsLoaded = false;
  loading = false;
  invitationsLoading = false;
  saving = false;
  error = '';
  private treeError = '';
  message = '';
  private savedAccountState: { id: number; role: AccountRole; profile_id: number | null } | null = null;

  constructor(
    readonly authService: AuthService,
    private readonly toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadAccounts();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['familyProfiles']) this.syncInviteProfile();
    if (changes['selectedTreeItemId']) this.applyTreeSelection();
  }

  get inviteProfiles(): User[] {
    if (!this.accountsLoaded || !this.invitationsLoaded) return [];
    const linkedProfileIds = new Set(
      [
        ...this.accounts.map((account) => account.profile_id),
        ...this.invitations
          .filter((invitation) => invitation.status === 'pending')
          .map((invitation) => invitation.profile_id),
      ].filter((profileId): profileId is number => profileId !== null),
    );
    return this.familyProfiles.filter((profile) => !linkedProfileIds.has(profile.id));
  }

  profileOptions(account: AuthAccount): User[] {
    return this.profilesForRole(account.role);
  }

  loadAccounts(): void {
    this.loading = true;
    this.accountsLoaded = false;
    this.invitationsLoaded = false;
    this.error = '';
    this.treeError = '';
    this.publishTreeData();
    this.publishEditorActions();
    this.authService.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts = accounts;
        this.accountsLoaded = true;
        this.loading = false;
        const selectedAccount = this.selectedAccount;
        if (selectedAccount) {
          this.saveAccountSnapshot(selectedAccount);
        } else {
          this.savedAccountState = null;
        }
        this.publishEditorActions();
        this.syncInviteProfile();
        this.loadInvitations();
        this.publishTreeData();
      },
      error: (error: unknown) => {
        this.loading = false;
        this.error = this.errorMessage(error, 'Konten konnten nicht geladen werden.');
        this.treeError = this.error;
        this.publishTreeData();
        this.publishEditorActions();
        this.toastService.show(false, this.error);
      },
    });
  }

  invite(): void {
    const profileId = this.inviteProfileId;
    if (
      this.loading ||
      !this.accountsLoaded ||
      profileId === null ||
      !this.inviteEmail.trim() ||
      !this.inviteProfiles.some((profile) => profile.id === profileId)
    ) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.message = '';
    this.authService.inviteAccount({
      email: this.inviteEmail.trim(),
      profile_id: profileId,
    }).subscribe({
      next: (result) => {
        this.saving = false;
        this.message = result.message;
        this.inviteEmail = '';
        this.loadInvitations();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Einladung konnte nicht versendet werden.');
      },
    });
  }

  loadInvitations(): void {
    this.invitationsLoading = true;
    this.invitationsLoaded = false;
    this.error = '';
    this.treeError = '';
    this.publishTreeData();
    this.publishEditorActions();
    this.authService.getInvitations().subscribe({
      next: (invitations) => {
        const previousInvitation = this.selectedInvitation;
        this.invitations = invitations;
        this.invitationsLoaded = true;
        this.invitationsLoading = false;
        if (previousInvitation && !invitations.some((item) => item.id === previousInvitation.id)) {
          const replacement = invitations.find(
            (item) =>
              item.status === 'pending' &&
              (item.email === previousInvitation.email ||
                item.profile_id === previousInvitation.profile_id),
          );
          this.selectedTreeItemChange.emit(
            replacement ? this.invitationTreeItemId(replacement) : null,
          );
        }
        this.syncInviteProfile();
        this.publishEditorActions();
        this.publishTreeData();
      },
      error: (error: unknown) => {
        this.invitationsLoading = false;
        this.error = this.errorMessage(error, 'Einladungen konnten nicht geladen werden.');
        this.publishTreeData();
        this.toastService.show(false, this.error);
      },
    });
  }

  resendInvitation(invitation: AccountInvitationRecord): void {
    this.saving = true;
    this.error = '';
    this.message = '';
    this.publishEditorActions();
    this.authService.resendInvitation(invitation.id).subscribe({
      next: (result) => {
        this.saving = false;
        this.message = result.message;
        this.loadInvitations();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Einladung konnte nicht erneut versendet werden.');
        this.publishEditorActions();
      },
    });
  }

  showInviteForm(): boolean {
    return this.selectedTreeItemId === null;
  }

  invitationTreeItemId(invitation: AccountInvitationRecord): string {
    return `invitation:${invitation.id}`;
  }

  save(account: AuthAccount): void {
    if (account.profile_id === null) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    this.publishEditorActions();
    this.authService.updateAccount(account.id, {
      role: account.role,
      profile_id: account.profile_id,
      is_active: account.is_active,
    }).subscribe({
      next: (result) => {
        this.saving = false;
        this.message = result.message;
        this.loadAccounts();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Konto konnte nicht gespeichert werden.');
        this.publishEditorActions();
      },
    });
  }

  isSelectedAccount(account: AuthAccount): boolean {
    return this.selectedTreeItemId === this.accountTreeItemId(account);
  }

  accountTreeItemId(account: AuthAccount): string {
    return `account:${account.id}`;
  }

  accountProfileName(account: AuthAccount): string {
    return this.familyProfiles.find((profile) => profile.id === account.profile_id)?.name
      ?? account.profile_name
      ?? 'Kein Profil';
  }

  onRoleChanged(account: AuthAccount): void {
    account.profile_id = this.profileOptions(account)[0]?.id ?? null;
    this.publishEditorActions();
  }

  publishEditorActions(): void {
    const invitation = this.selectedInvitation;
    if (invitation) {
      this.editorActionsChange.emit({
        dirty: false,
        canDelete: false,
        busy: this.saving,
        showSave: true,
        showSaveLabel: true,
        hideCancel: true,
        saveLabel: 'Einladung erneut senden',
        save: () => this.resendInvitation(invitation),
        cancel: () => undefined,
      });
      return;
    }
    const account = this.selectedAccount;
    if (!account) {
      this.editorActionsChange.emit(null);
      return;
    }
    this.editorActionsChange.emit({
      dirty: this.isSelectedAccountDirty(),
      canDelete: !this.isCurrentAccount(account),
      busy: this.saving,
      save: () => this.save(account),
      cancel: () => this.cancelAccountChanges(),
      delete: () => this.delete(account),
    });
  }

  delete(account: AuthAccount): void {
    if (!confirm(`Login-Konto ${account.email} wirklich entfernen? Das Familienprofil bleibt erhalten.`)) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    this.publishEditorActions();
    this.authService.deleteAccount(account.id).subscribe({
      next: () => {
        this.saving = false;
        this.message = 'Login-Konto entfernt.';
        this.selectedTreeItemChange.emit(null);
        this.savedAccountState = null;
        this.publishEditorActions();
        this.loadAccounts();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Konto konnte nicht entfernt werden.');
        this.publishEditorActions();
      },
    });
  }

  roleLabel(role: AccountRole): string {
    return {
      admin: 'Admin',
      adult: 'Erwachsener',
      teen: 'Jugendlicher',
      child: 'Kind',
      guest: 'Gast',
    }[role];
  }

  isCurrentAccount(account: AuthAccount): boolean {
    return this.authService.currentAccount?.id === account.id;
  }

  private get selectedAccount(): AuthAccount | null {
    if (!this.selectedTreeItemId?.startsWith('account:')) return null;
    const accountId = Number(this.selectedTreeItemId.slice('account:'.length));
    return this.accounts.find((account) => account.id === accountId) ?? null;
  }

  get selectedAccountDetails(): AuthAccount | null {
    return this.selectedAccount;
  }

  private get selectedInvitation(): AccountInvitationRecord | null {
    if (!this.selectedTreeItemId?.startsWith('invitation:')) return null;
    const invitationId = this.selectedTreeItemId.slice('invitation:'.length);
    return this.invitations.find((invitation) => invitation.id === invitationId) ?? null;
  }

  get selectedInvitationDetails(): AccountInvitationRecord | null {
    return this.selectedInvitation;
  }

  private isSelectedAccountDirty(): boolean {
    const account = this.selectedAccount;
    return Boolean(
      account &&
      this.savedAccountState?.id === account.id &&
      (account.role !== this.savedAccountState.role ||
        account.profile_id !== this.savedAccountState.profile_id),
    );
  }

  private cancelAccountChanges(): void {
    const account = this.selectedAccount;
    if (!account || this.savedAccountState?.id !== account.id) return;
    account.role = this.savedAccountState.role;
    account.profile_id = this.savedAccountState.profile_id;
    this.publishEditorActions();
  }

  private saveAccountSnapshot(account: AuthAccount): void {
    this.savedAccountState = {
      id: account.id,
      role: account.role,
      profile_id: account.profile_id,
    };
  }

  private applyTreeSelection(): void {
    const account = this.selectedAccount;
    if (account) {
      this.saveAccountSnapshot(account);
    } else {
      this.savedAccountState = null;
    }
    this.publishEditorActions();
  }

  private publishTreeData(): void {
    this.treeDataChange.emit({
      accounts: this.accounts,
      invitations: this.invitations,
      loading: this.loading,
      invitationsLoading: this.invitationsLoading,
      error: this.treeError,
    });
  }

  private profilesForRole(role: AccountRole): User[] {
    const profileRole: Record<AccountRole, User['role']> = {
      admin: 'adult',
      adult: 'adult',
      teen: 'child_14',
      child: 'child_10',
      guest: 'patchwork_guest',
    };
    return this.familyProfiles.filter((profile) => profile.role === profileRole[role]);
  }

  private syncInviteProfile(): void {
    const options = this.inviteProfiles;
    if (!options.some((profile) => profile.id === this.inviteProfileId)) {
      this.inviteProfileId = options[0]?.id ?? null;
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail = (error.error as { detail?: unknown } | null)?.detail;
      if (typeof detail === 'string') return detail;
    }
    return fallback;
  }
}
