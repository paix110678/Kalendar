import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AuthComponent } from './components/auth/auth.component';
import { CalendarShellComponent } from './components/calendar-shell.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CalendarShellComponent, AuthComponent],
  template: `
    @if (authState$ | async; as state) {
      @if (state.status === 'loading') {
        <main class="auth-loading" role="status">Anmeldestatus wird geprüft …</main>
      } @else if (state.status === 'error') {
        <main class="auth-loading" role="alert">
          <p>{{ state.error }}</p>
          <button type="button" (click)="authService.refreshSession()">Erneut versuchen</button>
        </main>
      } @else if (state.account) {
        <app-calendar-shell></app-calendar-shell>
      } @else {
        <app-auth></app-auth>
      }
    }
  `,
})
export class AppComponent {
  public readonly authService = inject(AuthService);
  readonly authState$ = this.authService.state$;
}
