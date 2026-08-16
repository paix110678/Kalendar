import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService, User } from '../../../services/calendar.service'; // BEHOBEN: Richtigen Service-Pfad importiert

@Component({
  selector: 'app-user-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-selector.component.html',
  styleUrl: './user-selector.component.css'
})
export class UserSelectorComponent {
  @Input() activeUsers: User[] = [];

  @Output() userVisibilityToggled = new EventEmitter<{userId: number, event: MouseEvent}>();
  @Output() rewardDashboardOpened = new EventEmitter<User>();

  // Lokaler Zwischenspeicher für den Ziehvorgang
  private draggedUserIndex: number | null = null;

  // KORREKTUR: Injiziert den CalendarService direkt im Konstruktor des Widgets
  constructor(private calendarService: CalendarService) {}

  public isUserVisible(userId: number): boolean {
    return !((window as any).hiddenUserIdsCache?.[userId]);
  }

  // WOFÜR: Merkt sich den Startpunkt der gezogenen Person im Gatter
  public onDragStart(index: number): void {
    this.draggedUserIndex = index;
  }

  // WOFÜR: Erlaubt das Überfliegen anderer Personen-Kapseln im Browser
  public onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  // KORREKTUR: Sortiert das lokale Array um und sendet die Daten DIREKT ohne Header-Umweg an die API
  public onDrop(targetIndex: number): void {
    if (this.draggedUserIndex === null || this.draggedUserIndex === targetIndex) return;

    // Kopie erzeugen, um Angulars Datenbindung sauber zu triggern
    const reorderedList = [...this.activeUsers];
    
    // Element heraustrennen und am neuen Zielindex einschieben
    const [draggedUser] = reorderedList.splice(this.draggedUserIndex, 1);
    reorderedList.splice(targetIndex, 0, draggedUser);

    this.draggedUserIndex = null;
    
    // Ruft die PUT-Abrechnung direkt im Service auf
    if (this.calendarService && typeof this.calendarService.updateUsersOrder === 'function') {
      this.calendarService.updateUsersOrder(reorderedList);
    }
  }
}
