import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalendarService, User, Reward, SystemConfig } from '../../services/calendar.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent implements OnInit {
  @Input() activeUsers: User[] = [];
  @Input() activeRewards: Reward[] = [];
  @Input() selectedUser: any = null;
  @Output() closeAdmin = new EventEmitter<void>();

  public showPasswordPrompt = false;
  public passwordInput = '';
  public passwordError = '';
  public pendingAction: 'create_reward' | 'update_config' = 'create_reward';

  public editingUserId: number | null = null;
  public editingRewardId: number | null = null;
  
  public tempEditName = '';
  public tempEditGroup: 'adult' | 'child' = 'child';
  public tempEditColor = '#228be6';

  public createUserName = '';
  public createUserGroup: 'adult' | 'child' = 'child';
  public createRewardTitle = '';
  public createRewardCost = 15;
  public createRewardType: 'snack' | 'extra_time' | 'cash' = 'snack';

  public localConfig: SystemConfig = { weather_city: 'Bremen', weather_plz: '28195', weather_service: 'open_meteo', api_key: '', live_temp: '--', live_rain: '--', high_temp: '--', low_temp: '--' };

  constructor(private calendarService: CalendarService) {}

  ngOnInit(): void {
    this.calendarService.config$.subscribe(cfg => {
      if (cfg) {
        this.localConfig = { ...cfg };
      }
    });
  }

  triggerConfigUpdateProtection(): void {
    this.pendingAction = 'update_config';
    this.showPasswordPrompt = true;
    this.passwordInput = '';
    this.passwordError = '';
  }

  verifyAdminAction(): void {
    this.calendarService.verifyAdminPassword(this.passwordInput).subscribe({
      next: () => {
        this.showPasswordPrompt = false;
        if (this.pendingAction === 'update_config') {
          this.executeConfigSave();
        } else if (this.pendingAction === 'create_reward') {
          this.submitNewReward();
        }
      },
      error: () => this.passwordError = 'Kennwort inkorrekt.'
    });
  }

  private executeConfigSave(): void {
    this.calendarService.updateSystemConfig(this.localConfig).subscribe({
      next: () => {
        // KORREKTUR: Lädt die system_config sofort reaktiv im Kalender-Vordergrund neu!
        this.calendarService.loadSystemConfig(); 
        alert('Wetterkonfiguration & API erfolgreich gespeichert!');
        this.closeAdmin.emit();
      },
      error: () => alert('Fehler beim Speichern der Konfiguration.')
    });
  }

  startEditUser(user: User): void {
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
      this.calendarService.loadAllBlocks();
    });
  }

  submitNewUser(): void {
    if (!this.createUserName.trim()) return;
    const finalRole = this.createUserGroup === 'adult' ? 'adult' : 'child_10';
    this.calendarService.addUser(this.createUserName, finalRole, '#228be6').subscribe(() => {
      this.createUserName = '';
      this.calendarService.loadAllBlocks();
    });
  }

  deleteUser(userId: number): void {
    if(confirm('Mitglied wirklich löschen?')) {
      this.calendarService.deleteUser(userId).subscribe(() => this.calendarService.loadAllBlocks());
    }
  }

  submitNewReward(): void {
    this.calendarService.addReward(this.createRewardTitle, this.createRewardCost, this.createRewardType).subscribe(() => {
      this.createRewardTitle = '';
    });
  }

  deleteReward(rewardId: number): void {
    if(confirm('Belohnung entfernen?')) this.calendarService.deleteReward(rewardId).subscribe();
  }
}
