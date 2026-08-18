import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User, TimeBlock, Reward, SystemConfig, Category } from './calendar.service';

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
  passTuev(id: number): Observable<any> { return this.http.post(this.apiBase + '/users/' + id + '/tuev-passed', {}); }

  getCategories(): Observable<Category[]> { return this.http.get<Category[]>(this.apiBase + '/blocks/categories'); }
  updateCategory(id: number, label: string, color: string, short: string): Observable<any> { return this.http.put(`${this.apiBase}/blocks/categories/${id}`, { label, color, default_short: short }); }
  getAllBlocks(): Observable<TimeBlock[]> { return this.http.get<TimeBlock[]>(this.apiBase + '/blocks/all'); }
  addTimeBlock(block: any): Observable<any> { return this.http.post(this.apiBase + '/blocks', block); }
  deleteTimeBlock(id: number): Observable<any> { return this.http.delete(this.apiBase + '/blocks/' + id); }
  
  // KORREKTUR: Akzeptiert jetzt das vollständige JSON-Objekt für JEDES Feld (Titel, Kürzel, Kategorie)
  moveTimeBlock(id: number, payload: any): Observable<any> { return this.http.put(`${this.apiBase}/blocks/${id}/move`, payload); }
  
  updateUserBlockOwner(id: number, uid: number): Observable<any> { return this.http.put(`${this.apiBase}/blocks/${id}/owner`, { user_id: uid }); }

  getRewards(): Observable<Reward[]> { return this.http.get<Reward[]>(this.apiBase + '/rewards'); }
  addReward(t: string, p: number, type: string): Observable<any> { return this.http.post(this.apiBase + '/rewards', { title: t, point_cost: p, type }); }
  updateReward(id: number, t: string, p: number, type: string): Observable<any> { return this.http.put(this.apiBase + '/rewards/' + id, { title: t, point_cost: p, type }); }
  deleteReward(id: number): Observable<any> { return this.http.delete(this.apiBase + '/rewards/' + id); }
  claimReward(uid: number, rid: number): Observable<any> { return this.http.post(this.apiBase + '/rewards/claim', { user_id: uid, reward_id: rid }); }

  getSystemConfig(): Observable<SystemConfig> { return this.http.get<SystemConfig>(this.apiBase + '/config'); }
  updateSystemConfig(cfg: SystemConfig): Observable<any> { return this.http.put(this.apiBase + '/config', cfg); }
  verifyAdminPassword(p: string): Observable<any> { return this.http.post(this.apiBase + '/admin/verify', { password: p }); }
  changeAdminPassword(o: string, n: string): Observable<any> { return this.http.post(this.apiBase + '/admin/change-password', { old_password: o, new_password: n }); }
}
