import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, HeaderPreferences, ProfileWeatherData } from '../../../services/api.service';
import { AuthAccount, AuthService } from '../../../services/auth.service';
import { CalendarService, User } from '../../../services/calendar.service';
import { AccountProfileComponent } from './account-profile.component';

describe('AccountProfileComponent', () => {
  let fixture: ComponentFixture<AccountProfileComponent>;
  const account: AuthAccount = {
    id: 1,
    family_id: 'family-1',
    email: 'alex@example.test',
    display_name: 'Alex',
    role: 'admin',
    profile_id: null,
    email_verified: true,
    is_active: true,
  };
  const preferences: HeaderPreferences = {
    show_users: true,
    show_view_mode: true,
    show_weather: true,
  };
  const profiles: User[] = [
    {
      id: 1,
      name: 'Alex',
      role: 'child_10',
      current_points: 0,
      status_school: 'GREEN',
      status_sport: 'BASE',
      color_code: '#228be6',
      state_code: null,
      assigned_plan_id: null,
      is_active: true,
    },
    {
      id: 2,
      name: 'Sam',
      role: 'child_14',
      current_points: 0,
      status_school: 'GREEN',
      status_sport: 'BASE',
      color_code: '#40c057',
      state_code: null,
      assigned_plan_id: null,
      is_active: false,
    },
  ];
  const profileWeather: ProfileWeatherData = {
    locations: [],
    selected_location_id: null,
    weather_city: '',
    weather_plz: '',
    weather_latitude: null,
    weather_longitude: null,
    live_temp: '',
    live_rain: '',
    high_temp: '',
    low_temp: '',
  };
  const updateUserProfile = vi.fn((userId: number, profile: Partial<User>) => {
    const user = profiles.find((item) => item.id === userId);
    if (!user) throw new Error(`Unknown profile: ${userId}`);
    return of({ user: { ...user, ...profile }, blocks_changed: false });
  });
  const calendarServiceMock = {
    users$: of(profiles),
    refreshProfileWeather: vi.fn(() => of(profileWeather)),
    updateProfileWeatherLocation: vi.fn(() => of(profileWeather)),
    updateHeaderPreferences: vi.fn(() => of(preferences)),
    updateUserProfile,
  };
  const authServiceMock = {
    currentAccount: account,
    logout: vi.fn(() => of({ message: 'ok' })),
  };

  beforeEach(async () => {
    authServiceMock.currentAccount = account;
    updateUserProfile.mockClear();
    calendarServiceMock.updateHeaderPreferences.mockClear();
    await TestBed.configureTestingModule({
      imports: [AccountProfileComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: CalendarService, useValue: calendarServiceMock },
        {
          provide: ApiService,
          useValue: { getHeaderPreferences: vi.fn(() => of(preferences)) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows every family profile in the account profile and saves its individual settings', () => {
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Familienprofile');
    expect(element.textContent).toContain('Alex');
    expect(element.textContent).toContain('Sam');
    expect(element.querySelectorAll('.profile-active-field input')).toHaveLength(2);
    expect(element.querySelectorAll('.profile-setting-row .color-picker-compact')).toHaveLength(2);
    expect(element.querySelector('.profile-color-field')).toBeNull();

    const profile = component.profileDrafts.find((item) => item.id === 2);
    if (!profile) throw new Error('Expected profile draft');
    profile.color_code = '#fa5252';
    profile.is_active = true;
    fixture.detectChanges();
    component.saveProfileSettings();

    expect(updateUserProfile).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ color_code: '#fa5252', is_active: true }),
    );
    expect(calendarServiceMock.updateHeaderPreferences).not.toHaveBeenCalled();
  });

  it('does not expose family profile settings to non-admin accounts', () => {
    authServiceMock.currentAccount = { ...account, role: 'adult' };
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.account-profile-settings')).toBeNull();
  });

  it('saves the display options from the account profile', () => {
    const component = fixture.componentInstance;
    component.displayPreferences.show_weather = false;
    fixture.detectChanges();
    component.saveProfileSettings();

    expect(calendarServiceMock.updateHeaderPreferences).toHaveBeenCalledWith({
      ...preferences,
      show_weather: false,
    });
    expect(updateUserProfile).not.toHaveBeenCalled();
  });
});
