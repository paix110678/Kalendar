import { Component } from '@angular/core';
import { CalendarShellComponent } from './components/calendar-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CalendarShellComponent],
  template: '<app-calendar-shell></app-calendar-shell>',
})
export class AppComponent {}
