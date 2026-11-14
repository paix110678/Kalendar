import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService, User } from '../../../services/calendar.service'; // BEHOBEN: Richtigen Service-Pfad importiert

@Component({
  selector: 'app-user-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-selector.component.html',
  styleUrls: [
    './user-selector.component.css',
    './user-selector.component.handy.css',
  ]
})
export class UserSelectorComponent {
  @Input() activeUsers: User[] = [];

  @Output() userVisibilityToggled = new EventEmitter<{userId: number, event: MouseEvent}>();
  @Output() rewardDashboardOpened = new EventEmitter<User>();
  public readonly isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

  // Lokaler Zwischenspeicher für den Ziehvorgang
  private draggedUserIndex: number | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressClickTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressNextRewardClick = false;
  private longPressStart: { pointerId: number; x: number; y: number } | null = null;

  // KORREKTUR: Injiziert den CalendarService direkt im Konstruktor des Widgets
  constructor(private calendarService: CalendarService) {}

  public isUserVisible(userId: number): boolean {
    return !((window as any).hiddenUserIdsCache?.[userId]);
  }

  public getUserAbbreviation(name: string): string {
    return name.split(/[_\s-]+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  }

  public startLongPress(event: PointerEvent, userId: number): void {
    this.cancelLongPress();
    if (this.suppressClickTimer !== null) clearTimeout(this.suppressClickTimer);
    this.suppressClickTimer = null;
    this.suppressNextRewardClick = false;
    if (event.pointerType !== 'touch') return;

    this.longPressStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.suppressNextRewardClick = true;
      this.suppressClickTimer = setTimeout(() => {
        this.suppressNextRewardClick = false;
        this.suppressClickTimer = null;
      }, 1000);
      this.userVisibilityToggled.emit({ userId, event });
    }, 600);
  }

  public moveLongPress(event: PointerEvent): void {
    if (this.longPressStart?.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - this.longPressStart.x, event.clientY - this.longPressStart.y) > 18) {
      this.cancelLongPress();
    }
  }

  public cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressStart = null;
  }

  public openRewards(user: User): void {
    if (this.suppressNextRewardClick) {
      this.suppressNextRewardClick = false;
      if (this.suppressClickTimer !== null) clearTimeout(this.suppressClickTimer);
      this.suppressClickTimer = null;
      return;
    }
    this.rewardDashboardOpened.emit(user);
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
