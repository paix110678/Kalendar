import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { KALENDAR_VERSION } from '../../version';

type AuthMode = 'login' | 'register' | 'verify' | 'accept' | 'reset' | 'forgot';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css',
})
export class AuthComponent implements OnInit {
  readonly version = KALENDAR_VERSION;
  readonly shortVersion = KALENDAR_VERSION === 'dev' ? 'dev' : KALENDAR_VERSION.slice(0, 7);
  mode: AuthMode = 'login';
  familyName = '';
  displayName = '';
  email = '';
  password = '';
  bootstrapToken = '';
  token = '';
  busy = false;
  error = '';
  message = '';

  constructor(private readonly authService: AuthService) {}

  ngOnInit(): void {
    this.token = new URLSearchParams(window.location.search).get('token') ?? '';
    const path = window.location.pathname;
    if (path.endsWith('/verify-email')) {
      this.mode = 'verify';
      this.verifyEmail();
    } else if (path.endsWith('/accept-invitation')) {
      this.mode = 'accept';
    } else if (path.endsWith('/reset-password')) {
      this.mode = 'reset';
    }
  }

  setMode(mode: AuthMode): void {
    this.mode = mode;
    this.error = '';
    this.message = '';
    this.password = '';
  }

  login(): void {
    this.run(
      this.authService.login(this.email, this.password),
      () => undefined,
    );
  }

  register(): void {
    const payload = {
      family_name: this.familyName,
      display_name: this.displayName,
      email: this.email,
      password: this.password,
      ...(this.bootstrapToken.trim() ? { bootstrap_token: this.bootstrapToken.trim() } : {}),
    };
    this.run(this.authService.register(payload), (result) => {
      this.message = result.message;
      this.password = '';
    });
  }

  verifyEmail(): void {
    if (!this.token) {
      this.mode = 'login';
      this.error = 'Der Bestätigungslink enthält kein Token.';
      return;
    }
    this.run(this.authService.verifyEmail(this.token), (result) => {
      this.mode = 'login';
      this.message = result.message;
      this.clearQuery();
    });
  }

  resendVerification(): void {
    this.run(this.authService.resendVerification(this.email), (result) => {
      this.message = result.message;
    });
  }

  acceptInvitation(): void {
    this.run(
      this.authService.acceptInvitation(this.token, this.displayName, this.password),
      (result) => {
        this.mode = 'login';
        this.message = result.message;
        this.password = '';
        this.clearQuery();
      },
    );
  }

  requestPasswordReset(): void {
    this.run(this.authService.requestPasswordReset(this.email), (result) => {
      this.message = result.message;
    });
  }

  resetPassword(): void {
    this.run(this.authService.resetPassword(this.token, this.password), (result) => {
      this.mode = 'login';
      this.message = result.message;
      this.password = '';
      this.clearQuery();
    });
  }

  private run<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    this.busy = true;
    this.error = '';
    this.message = '';
    request.subscribe({
      next: (value) => {
        this.busy = false;
        onSuccess(value);
      },
      error: (error: unknown) => {
        this.busy = false;
        this.error = this.errorMessage(error);
      },
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { detail?: string } | null;
      if (typeof body?.detail === 'string') return body.detail;
    }
    return 'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.';
  }

  private clearQuery(): void {
    window.history.replaceState({}, '', '/');
    this.token = '';
  }
}
