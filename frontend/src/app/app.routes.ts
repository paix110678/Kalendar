import { Routes } from '@angular/router';
import { CalendarShellComponent } from './components/calendar-shell.component';

export const routes: Routes = [
  {
    path: '',
    component: CalendarShellComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
