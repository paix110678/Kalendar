import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AccountInvitationRecord,
  AccountRole,
  AuthAccount,
  AuthService,
} from '../../../../../services/auth.service';
import { ToastService } from '../../../../../services/toast.service';
import { User } from '../../../../../services/calendar.service';

type InviteRole = Exclude<AccountRole, 'admin'>;

@Component({
  selector: 'app-account-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account-management.component.html',
  styleUrl: './account-management.component.css',
})
export class AccountManagementComponent implements OnInit, OnChanges {
  @Input() familyProfiles: User[] = [];

  accounts: AuthAccount[] = [];
  invitations: AccountInvitationRecord[] = [];
  inviteEmail = '';
  inviteRole: InviteRole = 'adult';
  inviteProfileId: number | null = null;
  loading = false;
  invitationsLoading = false;
  saving = false;
  error = '';
  message = '';

  constructor(
    readonly authService: AuthService,
    private readonly toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadAccounts();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['familyProfiles']) this.syncInviteProfile();
  }

  get inviteProfiles(): User[] {
    return this.profilesForRole(this.inviteRole);
  }

  profileOptions(account: AuthAccount): User[] {
    return this.profilesForRole(account.role);
  }

  onInviteRoleChange(): void {
    this.inviteProfileId = this.inviteProfiles[0]?.id ?? null;
  }

  loadAccounts(): void {
    this.loading = true;
    this.error = '';
    this.authService.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts = accounts;
        this.loading = false;
        this.loadInvitations();
      },
      error: (error: unknown) => {
        this.loading = false;
        this.error = this.errorMessage(error, 'Konten konnten nicht geladen werden.');
        this.toastService.show(false, this.error);
      },
    });
  }

  invite(): void {
    if (this.inviteProfileId === null) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    this.authService.inviteAccount({
      email: this.inviteEmail.trim(),
      role: this.inviteRole,
      profile_id: this.inviteProfileId,
    }).subscribe({
      next: (result) => {
        this.saving = false;
        this.message = result.message;
        this.inviteEmail = '';
        this.loadAccounts();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Einladung konnte nicht versendet werden.');
      },
    });
  }

  loadInvitations(): void {
    this.invitationsLoading = true;
    this.authService.getInvitations().subscribe({
      next: (invitations) => {
        this.invitations = invitations;
        this.invitationsLoading = false;
      },
      error: (error: unknown) => {
        this.invitationsLoading = false;
        this.error = this.errorMessage(error, 'Einladungen konnten nicht geladen werden.');
        this.toastService.show(false, this.error);
      },
    });
  }

  resendInvitation(invitation: AccountInvitationRecord): void {
    this.saving = true;
    this.error = '';
    this.message = '';
    this.authService.resendInvitation(invitation.id).subscribe({
      next: (result) => {
        this.saving = false;
        this.message = result.message;
        this.loadInvitations();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Einladung konnte nicht erneut versendet werden.');
      },
    });
  }

  save(account: AuthAccount): void {
    if (account.profile_id === null) return;
    this.saving = true;
    this.error = '';
    this.message = '';
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
      },
    });
  }

  delete(account: AuthAccount): void {
    if (!confirm(`Login-Konto ${account.email} wirklich entfernen? Das Familienprofil bleibt erhalten.`)) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    this.authService.deleteAccount(account.id).subscribe({
      next: () => {
        this.saving = false;
        this.message = 'Login-Konto entfernt.';
        this.loadAccounts();
      },
      error: (error: unknown) => {
        this.saving = false;
        this.error = this.errorMessage(error, 'Konto konnte nicht entfernt werden.');
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

  invitationStatusLabel(status: AccountInvitationRecord['status']): string {
    return {
      pending: 'Ausstehend',
      expired: 'Abgelaufen',
      accepted: 'Angenommen',
      revoked: 'Ersetzt',
    }[status];
  }

  isCurrentAccount(account: AuthAccount): boolean {
    return this.authService.currentAccount?.id === account.id;
  }

  private profilesForRole(role: AccountRole): User[] {
    const profileRole: Record<AccountRole, User['role']> = {
      admin: 'adult',
      adult: 'adult',
      teen: 'child_14',
      child: 'child_10',
      guest: 'patchwork_guest',
    };
    return this.familyProfiles.filter(
      (profile) => profile.is_active && profile.role === profileRole[role],
    );
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
