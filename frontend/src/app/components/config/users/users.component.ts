import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User } from '../../../services/calendar.service';
import { MemberDetailsComponent } from './member-details/member-details.component';
import { AdminEditorActions } from '../admin-editor-actions';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, MemberDetailsComponent],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent implements OnChanges {
  @Input() activeUsers: User[] = [];
  @Input() selectedUserId: number | null = null;
  @Output() memberClosed = new EventEmitter<void>();
  @Output() editorActionsChange = new EventEmitter<AdminEditorActions>();
  private calendarService = inject(CalendarService);
  public saving = false;
  public userActionError = '';

  public createUserName = '';
  public createUserGroup: 'adult' | 'child' = 'child';

  get selectedUser(): User | undefined {
    return this.activeUsers.find(user => user.id === this.selectedUserId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedUserId'] || changes['activeUsers']) this.publishEditorActions();
  }

  submitNewUser(): void {
    const name = this.createUserName.trim();
    if (!name) {
      this.userActionError = 'Bitte einen Namen eingeben.';
      return;
    }
    const finalRole = this.createUserGroup === 'adult' ? 'adult' : 'child_10';
    this.saving = true;
    this.userActionError = '';
    this.publishEditorActions();
    this.calendarService.addUser(name, finalRole, '#228be6').subscribe({
      next: () => {
        this.createUserName = '';
        this.saving = false;
        this.publishEditorActions();
      },
      error: (error: unknown) => {
        console.error('Familienmitglied konnte nicht hinzugefügt werden:', error);
        this.userActionError = 'Familienmitglied konnte nicht hinzugefügt werden.';
        this.saving = false;
        this.publishEditorActions();
      },
    });
  }

  publishEditorActions(): void {
    if (this.selectedUser) return;
    this.editorActionsChange.emit({
      dirty: this.createUserName.trim() !== '' || this.createUserGroup !== 'child',
      canDelete: false,
      busy: this.saving,
      save: () => this.submitNewUser(),
      cancel: () => {
        this.createUserName = '';
        this.createUserGroup = 'child';
        this.userActionError = '';
        this.publishEditorActions();
      },
    });
  }

  deleteUser(userId: number): void {
    if (!confirm('Mitglied wirklich löschen?')) return;
    this.saving = true;
    this.publishEditorActions();
    this.calendarService.deleteUser(userId).subscribe({
      next: () => {
        this.saving = false;
        this.memberClosed.emit();
      },
      error: (error: unknown) => {
        console.error(`Familienmitglied ${userId} konnte nicht gelöscht werden:`, error);
        this.userActionError = 'Familienmitglied konnte nicht gelöscht werden.';
        this.saving = false;
        this.publishEditorActions();
      },
    });
  }

  onMemberActionsChanged(actions: AdminEditorActions): void {
    const user = this.selectedUser;
    this.editorActionsChange.emit({
      ...actions,
      canDelete: actions.canDelete || user !== undefined,
      delete: actions.canDelete
        ? actions.delete
        : () => {
          if (user) this.deleteUser(user.id);
        },
    });
  }
}
