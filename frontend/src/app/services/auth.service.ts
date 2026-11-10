import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, map, Observable, tap } from 'rxjs';
import { setSessionCsrfToken } from './auth.interceptor';

export type AccountRole = 'admin' | 'adult' | 'teen' | 'child' | 'guest';

export interface AuthAccount {
  id: number;
  family_id: string;
  email: string;
  display_name: string;
  role: AccountRole;
  profile_id: number | null;
  profile_name?: string | null;
  email_verified: boolean;
  is_active: boolean;
  created_at?: string;
}

export interface AuthState {
  status: 'loading' | 'ready' | 'error';
  account: AuthAccount | null;
  error: string | null;
}

export interface AccountInvitation {
  email: string;
  role: Exclude<AccountRole, 'admin'>;
  profile_id: number;
}

export interface AccountUpdate {
  role: AccountRole;
  profile_id: number;
  is_active: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiBase = window.location.port === '4200'
    ? `${window.location.protocol}//${window.location.hostname}:8000/api`
    : '/api';
  private readonly stateSubject = new BehaviorSubject<AuthState>({
    status: 'loading',
    account: null,
    error: null,
  });
  readonly state$ = this.stateSubject.asObservable();
  private reloadingAfterSessionExpiry = false;

  constructor(private readonly http: HttpClient) {
    if (typeof window !== 'undefined') {
      window.addEventListener('kalendar:session-expired', () => {
        setSessionCsrfToken(null);
        this.stateSubject.next({ status: 'ready', account: null, error: null });
        this.reloadToClearFamilyData();
      });
    }
    this.refreshSession();
  }

  get currentAccount(): AuthAccount | null {
    return this.stateSubject.value.account;
  }

  refreshSession(): void {
    this.stateSubject.next({ status: 'loading', account: null, error: null });
    this.http.get<AuthAccount>(`${this.apiBase}/auth/me`, { observe: 'response' }).subscribe({
      next: (response) => {
        setSessionCsrfToken(response.headers.get('X-CSRF-Token'));
        if (!response.body) {
          this.stateSubject.next({
            status: 'error',
            account: null,
            error: 'Die Serverantwort zur Sitzung war leer.',
          });
          return;
        }
        this.stateSubject.next({ status: 'ready', account: response.body, error: null });
      },
      error: (error: unknown) => {
        setSessionCsrfToken(null);
        const status = error instanceof HttpErrorResponse ? error.status : null;
        this.stateSubject.next({
          status: status === 401 ? 'ready' : 'error',
          account: null,
          error: status === 401 ? null : 'Der Anmeldestatus konnte nicht geprüft werden.',
        });
      },
    });
  }

  login(email: string, password: string): Observable<AuthAccount> {
    return this.http.post<AuthAccount>(`${this.apiBase}/auth/login`, { email, password }, { observe: 'response' }).pipe(
      map((response: HttpResponse<AuthAccount>) => {
        setSessionCsrfToken(response.headers.get('X-CSRF-Token'));
        if (!response.body) throw new Error('Die Serverantwort zur Anmeldung war leer.');
        return response.body;
      }),
      tap((account) => this.stateSubject.next({ status: 'ready', account, error: null })),
    );
  }

  logout(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/logout`, {}).pipe(
      tap(() => {
        setSessionCsrfToken(null);
        this.stateSubject.next({ status: 'ready', account: null, error: null });
        this.reloadToClearFamilyData();
      }),
    );
  }

  private reloadToClearFamilyData(): void {
    if (typeof window === 'undefined' || this.reloadingAfterSessionExpiry) return;
    this.reloadingAfterSessionExpiry = true;
    window.location.reload();
  }

  register(payload: {
    family_name: string;
    display_name: string;
    email: string;
    password: string;
    bootstrap_token?: string;
  }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/register`, payload);
  }

  verifyEmail(token: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/verify-email`, { token });
  }

  resendVerification(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/resend-verification`, { email });
  }

  requestPasswordReset(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/request-password-reset`, { email });
  }

  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/reset-password`, { token, password });
  }

  acceptInvitation(token: string, displayName: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/accept-invitation`, {
      token,
      display_name: displayName,
      password,
    });
  }

  getAccounts(): Observable<AuthAccount[]> {
    return this.http.get<AuthAccount[]>(`${this.apiBase}/auth/accounts`);
  }

  inviteAccount(invitation: AccountInvitation): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/invitations`, invitation);
  }

  updateAccount(accountId: number, update: AccountUpdate): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiBase}/auth/accounts/${accountId}`, update);
  }

  deleteAccount(accountId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiBase}/auth/accounts/${accountId}`);
  }
}
