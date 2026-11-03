import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService } from '../../../services/calendar.service'; // Pfadtiefe an Ordnerstruktur angepasst

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css'
})
export class UsersComponent {
  @Input() activeUsers: any[] = [];
  private calendarService = inject(CalendarService);

  public editingUserId: number | null = null;
  public tempEditName = '';
  public tempEditGroup: 'adult' | 'child' = 'child';
  public tempEditColor = '#228be6';
  public createUserName = '';
  public createUserGroup: 'adult' | 'child' = 'child';

  startEditUser(user: any): void {
    this.editingUserId = user.id;
    this.tempEditName = user.name;
    this.tempEditGroup = user.role === 'adult' ? 'adult' : 'child';
    this.tempEditColor = user.color_code || '#228be6';
  }

  saveUserEdit(userId: number): void {
    if (!this.tempEditName.trim()) return;
    const finalRole = this.tempEditGroup === 'adult' ? 'adult' : 'child_10';
    this.calendarService.updateUser(userId, this.tempEditName, finalRole, this.tempEditColor).subscribe(() => {
      this.editingUserId = null;
    });
  }

  submitNewUser(): void {
    if (!this.createUserName.trim()) return;
    const finalRole = this.createUserGroup === 'adult' ? 'adult' : 'child_10';
    this.calendarService.addUser(this.createUserName, finalRole, '#228be6').subscribe(() => {
      this.createUserName = '';
    });
  }

  deleteUser(userId: number): void {
    if(confirm('Mitglied wirklich löschen?')) {
      this.calendarService.deleteUser(userId).subscribe();
    }
  }
}
