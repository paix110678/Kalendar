import { ApplicationConfig, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './services/auth.interceptor';
import { toastInterceptor } from './services/toast.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Aktiviert die klassische Zone-Erkennung für Intervalle und Canvas-Grafiken
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: LOCALE_ID, useValue: 'de-DE' },
    provideHttpClient(withInterceptors([authInterceptor, toastInterceptor]))
  ]
};
