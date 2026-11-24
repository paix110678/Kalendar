import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FamilyTask } from '../../../../../services/api.service';
import { User } from '../../../../../services/calendar.service';

@Component({
  selector: 'app-family-task-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './family-task-list.component.html',
  styleUrl: './family-task-list.component.css',
})
export class FamilyTaskListComponent implements AfterViewInit, OnChanges {
  @Input() memberId: number | null = null;
  @Input() tasks: FamilyTask[] = [];
  @Input() activeUsers: User[] = [];
  @Output() closeList = new EventEmitter<void>();
  @ViewChild('taskList') taskList?: ElementRef<HTMLElement>;

  showExpired = false;
  showSubtasks = false;
  statusFilter: 'open' | 'completed' | 'all' = 'open';
  fromDate = '';
  toDate = '';

  ngAfterViewInit(): void {
    this.initializeDateRange();
    setTimeout(() => this.scrollToCurrentWeek());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['memberId'] || changes['tasks']) {
      if (!this.fromDate) this.initializeDateRange();
    }
  }

  get memberName(): string {
    return this.activeUsers.find((user) => user.id === this.memberId)?.name ?? 'Familienmitglied';
  }

  get filteredTasks(): FamilyTask[] {
    const today = this.today();
    return this.tasks
      .filter((task) => task.member_id === this.memberId)
      .filter((task) => this.showSubtasks || task.parent_id === null)
      .filter((task) => this.statusFilter === 'all'
        || (this.statusFilter === 'open' ? !task.completed : task.completed))
      .filter((task) => this.showExpired || task.due_date >= today)
      .filter((task) => !this.fromDate || task.due_date >= this.fromDate)
      .filter((task) => !this.toDate || task.due_date <= this.toDate)
      .sort((left, right) =>
        left.due_date.localeCompare(right.due_date)
        || (left.parent_id ?? 0) - (right.parent_id ?? 0)
        || left.title.localeCompare(right.title, 'de'),
      );
  }

  get earnedPoints(): number {
    return this.filteredTasks.reduce(
      (total, task) => total + (task.points_awarded ? task.points : 0),
      0,
    );
  }

  get groupedTasks(): Array<{ date: string; tasks: FamilyTask[] }> {
    const groups = new Map<string, FamilyTask[]>();
    for (const task of this.filteredTasks) {
      const tasks = groups.get(task.due_date) ?? [];
      tasks.push(task);
      groups.set(task.due_date, tasks);
    }
    return [...groups.entries()].map(([date, tasks]) => ({ date, tasks }));
  }

  toggleExpired(show: boolean): void {
    this.showExpired = show;
    if (show) {
      this.fromDate = '';
    } else {
      this.initializeDateRange();
    }
  }

  formatDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('de-DE', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
  }

  resetDateFilter(): void {
    this.initializeDateRange();
  }

  private initializeDateRange(): void {
    const today = new Date();
    const mondayOffset = today.getDay() === 0 ? -6 : 1 - today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    this.fromDate = this.toDateKey(weekStart);
  }

  private scrollToCurrentWeek(): void {
    const element = this.taskList?.nativeElement.querySelector(
      `[data-date="${this.fromDate}"], [data-current-week="true"]`,
    );
    element?.scrollIntoView({ block: 'start' });
  }

  private today(): string {
    return this.toDateKey(new Date());
  }

  private toDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
