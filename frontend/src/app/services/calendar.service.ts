import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, switchMap, tap } from 'rxjs';
import { ApiService, PlanConflictResolution, PlanSubject, SystemConfigLocationResult, SystemConfigUpdateResult, UpdateUserProfileResult } from './api.service';

export interface User { id: number; name: string; role: 'adult' | 'child_10' | 'child_14' | 'patchwork_guest'; current_points: number; status_school: 'GREEN' | 'RED'; status_sport: 'BASE' | 'SILBER'; color_code: string; assigned_plan_id: number | null; }
export interface Category { id: number; value: string; label: string; color: string; default_short: string; } 
export interface TimeBlock { id: number; user_id: number; title: string; short_title?: string; day_of_week: 'Montag' | 'Dienstag' | 'Mittwoch' | 'Donnerstag' | 'Freitag' | 'Samstag' | 'Sonntag'; start_time: string; end_time: string; type: string; is_locked: boolean; color?: string | null; plan_assignment_id?: number | null; plan_period?: number | null; person_event_type_id?: number | null; is_visible?: boolean; }
export interface Reward { id: number; title: string; point_cost: number; type: 'snack' | 'extra_time' | 'cash'; }
export interface SystemConfig { weather_city: string; weather_plz: string; weather_latitude: number | null; weather_longitude: number | null; weather_service: 'open_meteo' | 'weather_api'; api_key: string; live_temp: string; live_rain: string; high_temp: string; low_temp: string; }

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private usersSubject = new BehaviorSubject<User[]>([]);
  public users$: Observable<User[]> = this.usersSubject.asObservable();
  private categoriesSubject = new BehaviorSubject<Category[]>([]); 
  public categories$: Observable<Category[]> = this.categoriesSubject.asObservable();
  
  // KORREKTUR: Echtes reaktives Subjekt für die Live-Vorschau des Entwurfs blocks im RAM!
  private drawnCategorySubject = new BehaviorSubject<string>('preview_blue');
  public drawnCategory$: Observable<string> = this.drawnCategorySubject.asObservable();

  private blocksSubject = new BehaviorSubject<TimeBlock[]>([]);
  public blocks$: Observable<TimeBlock[]> = this.blocksSubject.asObservable();
  private rewardsSubject = new BehaviorSubject<Reward[]>([]);
  public rewards$: Observable<Reward[]> = this.rewardsSubject.asObservable();
  private configSubject = new BehaviorSubject<SystemConfig>({ weather_city: 'Bremen', weather_plz: '28790', weather_latitude: null, weather_longitude: null, weather_service: 'open_meteo', api_key: '', live_temp: '--', live_rain: '--', high_temp: '--', low_temp: '--' });
  public config$: Observable<SystemConfig> = this.configSubject.asObservable();

  public readonly START_HOUR = 6; public readonly END_HOUR = 24; public readonly ROW_HEIGHT_PIXELS = 4.5;
  constructor(private apiService: ApiService) { this.loadInitialData(); }

  public getDrawnDay(): string { return localStorage.getItem('DRAWN_DAY') || ''; }
  public getDrawnStartTime(): string { return localStorage.getItem('DRAWN_START_TIME') || '09:00'; }
  public getDrawnEndTime(): string { return localStorage.getItem('DRAWN_END_TIME') || '10:00'; }
  public setDrawnStartTime(val: string): void { localStorage.setItem('DRAWN_START_TIME', val); }
  public setDrawnEndTime(val: string): void { localStorage.setItem('DRAWN_END_TIME', val); }

  public loadInitialData(): void { 
    this.loadCategories(); 
    this.loadUsers();
    this.loadAllBlocks();
    this.loadRewards();
    this.loadInitialSystemConfig();
  }
  public loadCategories(): void { this.apiService.getCategories().subscribe((c: Category[]) => this.categoriesSubject.next(c)); }
  public loadSystemConfig(): void { this.apiService.getSystemConfig().subscribe((c: SystemConfig) => this.configSubject.next(c)); }
  private loadInitialSystemConfig(): void {
    this.apiService.resolveWeatherLocation().subscribe({
      next: (_result: SystemConfigLocationResult) => this.loadSystemConfig(),
      error: (error: unknown) => {
        console.error('Standortprüfung beim Frontend-Start fehlgeschlagen:', error);
        this.loadSystemConfig();
      },
    });
  }
  public loadAllBlocks(): void {
    this.refreshAllBlocks().subscribe({
      error: (error: unknown) => console.error('Kalenderblöcke konnten nicht geladen werden:', error),
    });
  }
  public refreshAllBlocks(): Observable<TimeBlock[]> {
    return this.apiService.getAllBlocks().pipe(tap((blocks) => this.publishBlocks(blocks)));
  }
  private loadUsers(): void { this.apiService.getUsers().subscribe((users: User[]) => this.usersSubject.next(users)); }
  public refreshUsers(): void { this.loadUsers(); }
  private loadRewards(): void { this.apiService.getRewards().subscribe((rewards: Reward[]) => this.rewardsSubject.next(rewards)); }
  public updateUserProfile(userId: number, profile: Pick<User, 'name' | 'role' | 'color_code' | 'current_points' | 'status_school' | 'status_sport'>): Observable<UpdateUserProfileResult> {
    return this.apiService.updateUserProfile(userId, profile).pipe(tap(({ user, blocks_changed }) => {
      this.usersSubject.next(this.usersSubject.value.map((currentUser) => currentUser.id === userId ? user : currentUser));
      if (blocks_changed) this.loadAllBlocks();
    }));
  }
  public applyPlan(userId: number, planId: number, title: string, subjects: PlanSubject[], resolutions: PlanConflictResolution[] = []) {
    return this.apiService.applyPlan(userId, planId, title, subjects, resolutions).pipe(
      switchMap((result) => this.refreshAllBlocks().pipe(
        map((blocks) => {
          this.usersSubject.next(this.usersSubject.value.map((user) =>
            user.id === userId ? { ...user, assigned_plan_id: result.assigned_plan_id } : user,
          ));
          return result;
        }),
      )),
    );
  }

  private publishBlocks(blocks: TimeBlock[]): void {
    this.blocksSubject.next(blocks.map((block) => ({
      ...block,
      is_locked: Boolean(block.is_locked),
      is_visible: block.is_visible !== false && Boolean(block.is_visible ?? true),
    })));
  }
  public setPlanEventVisibility(blockId: number, visible: boolean) {
    return this.apiService.setPlanEventVisibility(blockId, visible).pipe(tap(({ is_visible }) => {
      this.blocksSubject.next(this.blocksSubject.value.map((block) =>
        block.id === blockId ? { ...block, is_visible } : block,
      ));
    }));
  }
  private updateUserPoints(userId: number, points: number): void {
    const user = this.usersSubject.value.find((candidate) => candidate.id === userId);
    if (!user) {
      this.loadUsers();
      return;
    }

    user.current_points = points;
    this.usersSubject.next([...this.usersSubject.value]);
  }

  public getCategoryColor(type: string): string {
    const found = this.categoriesSubject.value.find(c => c.value === type);
    return found ? found.color : '#adb5bd'; 
  }

  public updateBlockLivePreview(id: number, updatedFields: Partial<TimeBlock>): void {
    const currentBlocks = this.blocksSubject.value.map(block => {
      if (block.id === id) {
        return { ...block, ...updatedFields };
      }
      return block;
    });
    this.blocksSubject.next(currentBlocks);
  }

  public updateCategory(id: number, label: string, color: string, short: string): Observable<any> {
    return this.apiService.updateCategory(id, label, color, short).pipe(tap(() => { this.loadCategories(); this.loadAllBlocks(); }));
  }

  public addUser(n: string, r: string, c = '#228be6'): Observable<any> { return this.apiService.addUser(n, r, c).pipe(tap(() => this.loadUsers())); }
  public updateUser(id: number, n: string, r: string, c: string): Observable<any> { return this.apiService.updateUser(id, n, r, c).pipe(tap(() => this.loadUsers())); }
  public deleteUser(id: number): Observable<any> { return this.apiService.deleteUser(id).pipe(tap(() => { this.loadUsers(); this.loadAllBlocks(); })); }
  public updateUserBlockOwner(id: number, uid: number): Observable<any> { return this.apiService.updateUserBlockOwner(id, uid); }
  public addReward(t: string, p: number, type: string): Observable<any> { return this.apiService.addReward(t, p, type).pipe(tap(() => this.loadRewards())); }
  public updateReward(id: number, t: string, p: number, type: string): Observable<any> { return this.apiService.updateReward(id, t, p, type).pipe(tap(() => this.loadRewards())); }
  public deleteReward(id: number): Observable<any> { return this.apiService.deleteReward(id).pipe(tap(() => this.loadRewards())); }
  public addTimeBlock(block: any): Observable<any> { return this.apiService.addTimeBlock(block).pipe(tap(() => this.loadAllBlocks())); }
  public deleteTimeBlock(id: number): Observable<any> { return this.apiService.deleteTimeBlock(id).pipe(tap(() => this.loadAllBlocks())); }
  
  public moveTimeBlock(id: number, arg2: any, start?: string, end?: string): Observable<any> { 
    if (typeof arg2 === 'string') {
      const payload = { day_of_week: arg2, start_time: start, end_time: end };
      return this.apiService.moveTimeBlock(id, payload).pipe(tap(() => this.loadAllBlocks()));
    }
    return this.apiService.moveTimeBlock(id, arg2).pipe(tap(() => this.loadAllBlocks())); 
  }
  
  public updateUsersOrder(newOrder: User[]): void { this.usersSubject.next(newOrder); this.apiService.saveUserOrder(newOrder.map(u => u.id)).subscribe(); }
  public claimReward(uid: number, rid: number): Observable<any> {
    return this.apiService.claimReward(uid, rid).pipe(tap((result: { remaining_points: number }) => this.updateUserPoints(uid, result.remaining_points)));
  }
  public passTuev(id: number): Observable<any> {
    return this.apiService.passTuev(id).pipe(tap((result: { current_points: number }) => this.updateUserPoints(id, result.current_points)));
  }
  public updateSystemConfig(cfg: SystemConfig): Observable<SystemConfigUpdateResult> {
    return this.apiService.updateSystemConfig(cfg).pipe(tap(() => this.loadSystemConfig()));
  }
  public verifyAdminPassword(p: string): Observable<any> { return this.apiService.verifyAdminPassword(p); }
  public changeAdminPassword(o: string, n: string): Observable<any> { return this.apiService.changeAdminPassword(o, n); }

  // KORREKTUR: Steuert den Entwurfs-Typ nun voll-reaktiv über den RAM-Safe
  public getDrawnCategory(): string { return this.drawnCategorySubject.value; }
  public setDrawnCategory(val: string): void { this.drawnCategorySubject.next(val); }

  public timeToGridRow(timeStr: string): number { 
    if (!timeStr || !timeStr.includes(':')) return 1; 
    const [hoursStr, minutesStr] = timeStr.split(':');
    const hours = Number(hoursStr); const minutes = Number(minutesStr);
    if (isNaN(hours) || isNaN(minutes)) return 1; 
    return Math.max(1, Math.floor(((hours * 60 + minutes) - (this.START_HOUR * 60)) / 5) + 1); 
  }
  public durationToGridRows(s: string, e: string): number { return this.timeToGridRow(e) - this.timeToGridRow(s); }
  public gridRowToTime(r: number): string { const m = (r - 1) * 5 + (this.START_HOUR * 60); return `${this.padZero(Math.floor(m / 60))}:${this.padZero(m % 60)}`; }
  public getDrawnEndTimeString(s: number, e: number): string { const d = (e - s) * 5; return d % 15 !== 0 ? this.gridRowToTime(s + Math.round(d / 15) * 3) : this.gridRowToTime(e); }
  private padZero(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
  public updateSchoolStatus(id: number, status: 'GREEN' | 'RED'): void {
    this.apiService.updateSchoolStatus(id, status).subscribe(() => { this.loadUsers(); this.loadAllBlocks(); });
  }
  public updateSportStatus(id: number, status: 'BASE' | 'SILBER'): void {
    this.apiService.updateSportStatus(id, status).subscribe(() => { this.loadUsers(); this.loadAllBlocks(); });
  }
}
