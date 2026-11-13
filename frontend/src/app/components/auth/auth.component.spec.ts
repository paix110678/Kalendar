import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { AuthComponent } from './auth.component';

describe('AuthComponent', () => {
  let fixture: ComponentFixture<AuthComponent>;
  let authService: {
    login: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    resendVerification: ReturnType<typeof vi.fn>;
    requestPasswordReset: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authService = {
      login: vi.fn(() => of({})),
      register: vi.fn(() => of({ message: 'Bestätige deine E-Mail.' })),
      resendVerification: vi.fn(() => of({ message: 'Gesendet.' })),
      requestPasswordReset: vi.fn(() => of({ message: 'Gesendet.' })),
    };
    await TestBed.configureTestingModule({
      imports: [AuthComponent],
      providers: [{
        provide: AuthService,
        useValue: authService,
      }],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthComponent);
    fixture.detectChanges();
  });

  it('shows the login and registration labels and password confirmation field', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')).toBeNull();
    expect(element.querySelector('.auth-version')).toBeNull();
    expect(fixture.componentInstance.headerStateChange.observed).toBe(false);

    const registerLink = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Registrierung'));
    if (!registerLink) throw new Error('Registration link was not rendered.');
    const headerStateChange = vi.spyOn(fixture.componentInstance.headerStateChange, 'emit');
    registerLink.click();
    fixture.detectChanges();

    expect(element.querySelector('h1')).toBeNull();
    expect(headerStateChange).toHaveBeenLastCalledWith({ title: 'Registrierung', showBack: true });
    expect(element.querySelector('input[name="familyName"]')).not.toBeNull();
    expect(element.querySelector('input[name="registerPasswordConfirm"]')).not.toBeNull();
    expect(element.querySelector('#bootstrap-token')).toBeNull();
  });

  it('requires matching passwords and submits without a bootstrap token', () => {
    const component = fixture.componentInstance;
    component.familyName = 'Beispiel';
    component.displayName = 'Alex';
    component.email = 'alex@example.com';
    component.password = 'a sufficiently long password';
    component.passwordConfirmation = 'a different long password';
    component.register();

    expect(authService.register).not.toHaveBeenCalled();
    expect(component.error).toBe('Die Passwörter stimmen nicht überein.');

    component.passwordConfirmation = component.password;
    component.register();
    expect(authService.register).toHaveBeenCalledWith({
      family_name: 'Beispiel',
      display_name: 'Alex',
      email: 'alex@example.com',
      password: 'a sufficiently long password',
    });
  });
});
