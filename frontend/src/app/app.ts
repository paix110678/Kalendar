import { Component } from '@angular/core';
import { CalendarShellComponent } from './components/calendar-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CalendarShellComponent], // Bindet die Shell direkt und ohne Umwege als Root ein
  template: `<app-calendar-shell></app-calendar-shell>` // Zwingt Angular, mit der Shell zu starten
})
export class AppComponent {}

// Wir bereinigen die App-Konfiguration von ungenutzten Providern
export const appConfig = {
  providers: []
};
