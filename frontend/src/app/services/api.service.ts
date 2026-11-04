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

export interface PlanSubject {
  day_of_week: string;
  period: number;
  event_type_id: number;
  visible: boolean;
}

export interface PersonEventType {
  id: number;
  user_id: number;
  name: string;
  color: string;
}

export interface PlanConflict {
  id: number;
  title: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  type: string;
}

export interface PlanConflictResolution {
  block_id: number;
  action: 'delete' | 'move';
  day_of_week?: string;
  start_time?: string;
  end_time?: string;
}

export interface PlanAssignmentEvent extends Omit<PlanSubject, 'event_type_id'> {
  id: number;
  event_type_id: number | null;
  title: string;
  color: string;
  start_time: string;
  end_time: string;
}

export interface PlanAssignment {
  id: number;
  user_id: number;
  plan_id: number;
  title: string;
  events: PlanAssignmentEvent[];
}

export interface ApplyPlanResult {
  status: string;
  created_blocks: number;
  assigned_plan_id: number;
  assignment_id: number;
}

export interface UpdateUserProfileResult {
  user: User;
  blocks_changed: boolean;
}

export interface SystemConfigUpdateResult {
  status: string;
  location_resolved: boolean;
  location_error: string | null;
}

export interface SystemConfigLocationResult {
  location_resolved: boolean;
  location_error: string | null;
}

export interface Holiday {
  state_code: string;
  year: number;
  holiday_type: 'school' | 'public';
  name: string;
  start_date: string;
  end_date: string;
}

export interface HolidayStateData {
  state_code: string;
  years: number[];
  holidays: Holiday[];
}

export const GERMAN_STATES = [
  { code: 'BW', name: 'Baden-Württemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thüringen' },
] as const;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly apiBase = 'http://localhost:8000/api';
  constructor(private http: HttpClient) {}

  getUsers(): Observable<User[]> { return this.http.get<User[]>(this.apiBase + '/users'); }
  addUser(name: string, role: string, color: string): Observable<any> { return this.http.post(this.apiBase + '/users', { name, role, color_code: color }); }
  updateUser(id: number, name: string, role: string, color: string): Observable<any> { return this.http.put(this.apiBase + '/users/' + id, { name, role, color_code: color }); }
  updateUserProfile(id: number, profile: Pick<User, 'name' | 'role' | 'color_code' | 'current_points' | 'status_school' | 'status_sport'>): Observable<UpdateUserProfileResult> {
    return this.http.put<UpdateUserProfileResult>(`${this.apiBase}/users/${id}/profile`, profile);
  }
  applyPlan(userId: number, planId: number, title: string, subjects: PlanSubject[], resolutions: PlanConflictResolution[] = []): Observable<ApplyPlanResult> {
    return this.http.post<ApplyPlanResult>(`${this.apiBase}/users/${userId}/apply-plan`, {
      plan_id: planId,
      title,
      subjects,
      resolutions,
    });
  }
  getUserPlanAssignment(userId: number): Observable<PlanAssignment | null> {
    return this.http.get<PlanAssignment | null>(`${this.apiBase}/users/${userId}/plan-assignment`);
  }
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
  setPlanEventVisibility(id: number, visible: boolean): Observable<{ id: number; is_visible: boolean }> {
    return this.http.put<{ id: number; is_visible: boolean }>(`${this.apiBase}/blocks/${id}/visibility`, { visible });
  }
  updateUserBlockOwner(id: number, uid: number): Observable<any> { return this.http.put(`${this.apiBase}/blocks/${id}/owner`, { user_id: uid }); }

  // NEU: Datenbank-Katalog-Abfragen
  getDatabaseTables(): Observable<string[]> { return this.http.get<string[]>(`${this.apiBase}/blocks/db/tables`); }
  getTableData(tableName: string): Observable<{columns: string[], rows: any[]}> { return this.http.get<any>(`${this.apiBase}/blocks/db/tables/${tableName}`); }

  getPlans(): Observable<PlanDefinition[]> { return this.http.get<PlanDefinition[]>(`${this.apiBase}/plans`); }
  createPlan(plan: Omit<PlanDefinition, 'id'>): Observable<PlanDefinition> { return this.http.post<PlanDefinition>(`${this.apiBase}/plans`, plan); }
  updatePlan(id: number, plan: Omit<PlanDefinition, 'id'>): Observable<PlanDefinition> { return this.http.put<PlanDefinition>(`${this.apiBase}/plans/${id}`, plan); }
  deletePlan(id: number): Observable<void> { return this.http.delete<void>(`${this.apiBase}/plans/${id}`); }
  getHolidayStates(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiBase}/holidays/states`);
  }
  addHolidayState(stateCode: string): Observable<HolidayStateData> {
    return this.http.post<HolidayStateData>(`${this.apiBase}/holidays/states`, {
      state_code: stateCode,
    });
  }
  getHolidays(stateCode: string): Observable<Holiday[]> {
    return this.http.get<Holiday[]>(
      `${this.apiBase}/holidays/states/${encodeURIComponent(stateCode)}/holidays`,
    );
  }
  getPersonEventTypes(userId: number): Observable<PersonEventType[]> {
    return this.http.get<PersonEventType[]>(`${this.apiBase}/users/${userId}/event-types`);
  }
  createPersonEventType(userId: number, name: string, color: string): Observable<PersonEventType> {
    return this.http.post<PersonEventType>(`${this.apiBase}/users/${userId}/event-types`, { name, color });
  }
  updatePersonEventType(userId: number, eventTypeId: number, name: string, color: string): Observable<PersonEventType> {
    return this.http.put<PersonEventType>(`${this.apiBase}/users/${userId}/event-types/${eventTypeId}`, { name, color });
  }
  deletePersonEventType(userId: number, eventTypeId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiBase}/users/${userId}/event-types/${eventTypeId}`);
  }

  getRewards(): Observable<Reward[]> { return this.http.get<Reward[]>(this.apiBase + '/rewards'); }
  addReward(t: string, p: number, type: string): Observable<any> { return this.http.post(this.apiBase + '/rewards', { title: t, point_cost: p, type }); }
  updateReward(id: number, t: string, p: number, type: string): Observable<any> { return this.http.put(this.apiBase + '/rewards/' + id, { title: t, point_cost: p, type }); }
  deleteReward(id: number): Observable<any> { return this.http.delete(this.apiBase + '/rewards/' + id); }
  claimReward(uid: number, rid: number): Observable<{ remaining_points: number }> { return this.http.post<{ remaining_points: number }>(this.apiBase + '/rewards/claim', { user_id: uid, reward_id: rid }); }

  getSystemConfig(): Observable<SystemConfig> { return this.http.get<SystemConfig>(this.apiBase + '/config'); }
  resolveWeatherLocation(): Observable<SystemConfigLocationResult> {
    return this.http.post<SystemConfigLocationResult>(this.apiBase + '/config/location', {});
  }
  updateSystemConfig(cfg: SystemConfig): Observable<SystemConfigUpdateResult> {
    return this.http.put<SystemConfigUpdateResult>(this.apiBase + '/config', cfg);
  }
  verifyAdminPassword(p: string): Observable<any> { return this.http.post(this.apiBase + '/admin/verify', { password: p }); }
  changeAdminPassword(o: string, n: string): Observable<any> { return this.http.post(this.apiBase + '/admin/change-password', { old_password: o, new_password: n }); }
}
