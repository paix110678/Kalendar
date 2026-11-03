import { Route, Router, Routes } from '@angular/router';
import { CalendarShellComponent } from './components/calendar-shell.component';

// ✅ Lade alle Komponenten aus dem gleichen Modul für einfaches Testing
export const routes: Routes = [
  {
    path: '',
    component: CalendarShellComponent,
    // ✅ Bundle Optimizer - Lazy Loading aktivieren!
    data: { lazy: true }
  },
  {
    path: '**',
    redirectTo: ''
  }
];

// ✅ Dynamic Import für bessere Code-Splitting-Performance
async function loadDynamicComponent() {
  const component = await import('./components/calendar-shell.component');
  return component.CalendarShellComponent;
}
