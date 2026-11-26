import { Component } from '@angular/core';
import { CalendarShellComponent } from './components/calendar-shell.component';
import { UpdatePromptComponent } from './components/update-prompt/update-prompt.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CalendarShellComponent, UpdatePromptComponent],
  template: '<app-calendar-shell></app-calendar-shell><app-update-prompt></app-update-prompt>',
})
export class AppComponent {}
