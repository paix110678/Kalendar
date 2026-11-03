import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User, TimeBlock, Reward, SystemConfig, Category } from './calendar.service';

export interface PlanHour {
  start_time: string;
  end_time: string;
}

export interface PlanDefinition {
  id: number;
  name: string;
  start_day: string;
  end_day: string;
  hours_count: number;
  hours: PlanHour[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly apiBase = 'http://localhost:8000/api';
  constructor(private http: HttpClient) {}

  getUsers(): Observable<User[]> { return this.http.get<User[]>(this.apiBase + '/users'); }
  addUser(name: string, role: string, color: string): Observable<any> { return this.http.post(this.apiBase + '/users', { name, role, color_code: color }); }
  updateUser(id: number, name: string, role: string, color: string): Observable<any> { return this.http.put(this.apiBase + '/users/' + id, { name, role, color_code: color }); }
  deleteUser(id: number): Observable<any> { return this.http.delete(this.apiBase + '/users/' + id); }
  saveUserOrder(ids: number[]): Observable<any> { return this.http.put(this.apiBase + '/users/reorder', { user_ids: ids }); }
  updateSchoolStatus(id: number, status: string): Observable<any> { return this.http.put(this.apiBase + '/users/' + id + '/status-school', { status }); }
  updateSportStatus(id: number, status: string): Observable<any> { return this.http.put(this.apiBase + '/users/' + id + '/status-sport', { status }); }
  passTuev(id: number): Observable<{ current_points: number }> { return this.http.post<{ current_points: number }>(this.apiBase + '/users/' + id + '/tuev-passed', {}); }

  getCategories(): Observable<Category[]> { return this.http.get<Category[]>(this.apiBase + '/blocks/categories'); }
  updateCategory(id: number, label: string, color: string, short: string): Observable<any> { return this.http.put(`${this.apiBase}/blocks/categories/${id}`, { label, color, default_short: short }); }
  getAllBlocks(): Observable<TimeBlock[]> { return this.http.get<TimeBlock[]>(this.apiBase + '/blocks/all'); }
  addTimeBlock(block: any): Observable<any> { return this.http.post(this.apiBase + '/blocks', block); }
  deleteTimeBlock(id: number): Observable<any> { return this.http.delete(this.apiBase + '/blocks/' + id); }
  moveTimeBlock(id: number, payload: any): Observable<any> { return this.http.put(`${this.apiBase}/blocks/${id}/move`, payload); }
  updateUserBlockOwner(id: number, uid: number): Observable<any> { return this.http.put(`${this.apiBase}/blocks/${id}/owner`, { user_id: uid }); }

  // NEU: Datenbank-Katalog-Abfragen
  getDatabaseTables(): Observable<string[]> { return this.http.get<string[]>(`${this.apiBase}/blocks/db/tables`); }
  getTableData(tableName: string): Observable<{columns: string[], rows: any[]}> { return this.http.get<any>(`${this.apiBase}/blocks/db/tables/${tableName}`); }

  getPlans(): Observable<PlanDefinition[]> { return this.http.get<PlanDefinition[]>(`${this.apiBase}/plans`); }
  createPlan(plan: Omit<PlanDefinition, 'id'>): Observable<PlanDefinition> { return this.http.post<PlanDefinition>(`${this.apiBase}/plans`, plan); }
  updatePlan(id: number, plan: Omit<PlanDefinition, 'id'>): Observable<PlanDefinition> { return this.http.put<PlanDefinition>(`${this.apiBase}/plans/${id}`, plan); }
  deletePlan(id: number): Observable<void> { return this.http.delete<void>(`${this.apiBase}/plans/${id}`); }

  getRewards(): Observable<Reward[]> { return this.http.get<Reward[]>(this.apiBase + '/rewards'); }
  addReward(t: string, p: number, type: string): Observable<any> { return this.http.post(this.apiBase + '/rewards', { title: t, point_cost: p, type }); }
  updateReward(id: number, t: string, p: number, type: string): Observable<any> { return this.http.put(this.apiBase + '/rewards/' + id, { title: t, point_cost: p, type }); }
  deleteReward(id: number): Observable<any> { return this.http.delete(this.apiBase + '/rewards/' + id); }
  claimReward(uid: number, rid: number): Observable<{ remaining_points: number }> { return this.http.post<{ remaining_points: number }>(this.apiBase + '/rewards/claim', { user_id: uid, reward_id: rid }); }

  getSystemConfig(): Observable<SystemConfig> { return this.http.get<SystemConfig>(this.apiBase + '/config'); }
  updateSystemConfig(cfg: SystemConfig): Observable<any> { return this.http.put(this.apiBase + '/config', cfg); }
  verifyAdminPassword(p: string): Observable<any> { return this.http.post(this.apiBase + '/admin/verify', { password: p }); }
  changeAdminPassword(o: string, n: string): Observable<any> { return this.http.post(this.apiBase + '/admin/change-password', { old_password: o, new_password: n }); }
}
