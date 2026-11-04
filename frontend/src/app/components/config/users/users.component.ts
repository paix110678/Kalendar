import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User } from '../../../services/calendar.service';
import { MemberDetailsComponent } from './member-details/member-details.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, MemberDetailsComponent],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent {
  @Input() activeUsers: User[] = [];
  @Input() selectedUserId: number | null = null;
  @Output() memberClosed = new EventEmitter<void>();
  private calendarService = inject(CalendarService);

  public createUserName = '';
  public createUserGroup: 'adult' | 'child' = 'child';

  get selectedUser(): User | undefined {
    return this.activeUsers.find(user => user.id === this.selectedUserId);
  }

  roleLabel(role: User['role']): string {
    const labels: Record<User['role'], string> = {
      adult: 'Erwachsene',
      child_10: 'Kind (10+)',
      child_14: 'Jugendliche (14+)',
      patchwork_guest: 'Gast',
    };
    return labels[role];
  }

  submitNewUser(): void {
    const name = this.createUserName.trim();
    if (!name) return;
    const finalRole = this.createUserGroup === 'adult' ? 'adult' : 'child_10';
    this.calendarService.addUser(name, finalRole, '#228be6').subscribe(() => {
      this.createUserName = '';
    });
  }

  deleteUser(userId: number): void {
    if(confirm('Mitglied wirklich löschen?')) {
      this.calendarService.deleteUser(userId).subscribe(() => this.memberClosed.emit());
    }
  }
}
