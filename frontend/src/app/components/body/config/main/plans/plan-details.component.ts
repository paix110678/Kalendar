import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlanHour, TaskDefinition } from '../../../../../services/api.service';
import { Category } from '../../../../../services/calendar.service';
import {
  PlanLearn,
  type PlanCategory,
  type PlanDay,
  type PlanEntry,
  type PlanEntryChange,
  type PlanSubject,
  type PlanTimeSlot,
} from 'plan-learn';

export interface PlanValidationIssue {
  target: 'name' | 'weekdays' | 'hours-count' | 'hours' | 'hour' | 'uniform-task' | 'activity-grid' | 'general';
  message: string;
  day?: string;
  hourIndex?: number;
  field?: 'start_time' | 'end_time';
}

export type UnitInsertionPosition = 'before' | 'after';

@Component({
  selector: 'app-plan-details',
  standalone: true,
  imports: [CommonModule, FormsModule, PlanLearn],
  templateUrl: './plan-details.component.html',
  styleUrls: ['./plans.component.css', './plans-weekdays.css', './plan-details.component.css'],
})
export class PlanDetailsComponent implements OnChanges {
  @Input() planName = '';
  @Input() daysOfWeek: string[] = [];
  @Input() selectedDays: string[] = [];
  @Input() uniformCount = true;
  @Input() uniformTime = true;
  @Input() uniformActivities = true;
  @Input() hoursCount = 6;
  @Input() hours: PlanHour[] = [];
  @Input() dayHours: Record<string, PlanHour[]> = {};
  @Input() excludeSchoolHolidays = false;
  @Input() excludePublicHolidays = false;
  @Input() categories: Category[] = [];
  @Input() tasks: TaskDefinition[] = [];
  @Input() uniformTaskId: number | null = null;
  @Input() activitySubjects: Record<string, number[]> = {};
  @Input() validationIssues: PlanValidationIssue[] = [];
  @Input() unitInsertionPosition: UnitInsertionPosition = 'before';
  selectedCategoryId: number | null = null;
  private hoursCountDraft: string | null = null;
  private dayCountDrafts: Record<string, string> = {};

  @Output() uniformTimeChange = new EventEmitter<boolean>();
  @Output() uniformCountChange = new EventEmitter<boolean>();
  @Output() uniformActivitiesChange = new EventEmitter<boolean>();
  @Output() excludeSchoolHolidaysChange = new EventEmitter<boolean>();
  @Output() excludePublicHolidaysChange = new EventEmitter<boolean>();
  @Output() hoursCountChange = new EventEmitter<number>();
  @Output() hourTimesChange = new EventEmitter<void>();
  @Output() dayCountChange = new EventEmitter<{ day: string; value: number }>();
  @Output() dayToggleChange = new EventEmitter<{ day: string; checked: boolean }>();
  @Output() uniformTaskIdChange = new EventEmitter<number | null>();
  @Output() activitySubjectsChange = new EventEmitter<Record<string, number[]>>();
  @Output() unitInsertionPositionChange = new EventEmitter<UnitInsertionPosition>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['hoursCount']) this.hoursCountDraft = null;
    if (changes['uniformTaskId'] || changes['tasks']) {
      const selectedTask = this.tasks.find((task) => task.id === this.uniformTaskId);
      this.selectedCategoryId = selectedTask?.category_id ?? null;
    }
  }

  onCategoryChange(categoryId: number | null): void {
    this.selectedCategoryId = categoryId;
    if (this.uniformTaskId !== null && !this.tasks.some((task) =>
      task.id === this.uniformTaskId
      && (categoryId === null || task.category_id === categoryId)
    )) {
      this.uniformTaskIdChange.emit(null);
    }
  }

  get availableTasks(): TaskDefinition[] {
    return this.tasks
      .filter((task) => this.selectedCategoryId === null || task.category_id === this.selectedCategoryId)
      .sort((left, right) => left.title.localeCompare(right.title, 'de'));
  }

  hasValidationIssue(target: PlanValidationIssue['target'], day?: string, hourIndex?: number): boolean {
    return this.validationIssues.some((issue) =>
      issue.target === target
      && (day === undefined || issue.day === day)
      && (hourIndex === undefined || issue.hourIndex === hourIndex),
    );
  }

  getValidationMessages(target: PlanValidationIssue['target'], day?: string, hourIndex?: number): string[] {
    return this.validationIssues
      .filter((issue) =>
        issue.target === target
        && (day === undefined || issue.day === day)
        && (hourIndex === undefined || issue.hourIndex === hourIndex),
      )
      .map((issue) => issue.message);
  }

  hasHourFieldIssue(day: string | undefined, hourIndex: number, field: 'start_time' | 'end_time'): boolean {
    return this.validationIssues.some((issue) =>
      issue.target === 'hour'
      && issue.hourIndex === hourIndex
      && issue.day === day
      && (issue.field === undefined || issue.field === field),
    );
  }

  getHourValidationMessages(day: string | undefined, hourIndex: number): string[] {
    return this.validationIssues
      .filter((issue) =>
        issue.target === 'hour'
        && issue.hourIndex === hourIndex
        && issue.day === day,
      )
      .map((issue) => issue.message);
  }

  getDayCount(day: string): number {
    return this.dayHours[day]?.length ?? Math.max(1, this.hoursCount);
  }

  get hoursCountInputValue(): string {
    return this.hoursCountDraft ?? String(this.hoursCount);
  }

  onHoursCountDraftInput(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.hoursCountDraft = event.target.value;
    }
  }

  commitHoursCount(): void {
    const draft = this.hoursCountDraft;
    if (draft === null) return;
    this.hoursCountDraft = null;
    if (!/^\d+$/.test(draft)) return;
    const value = Number(draft);
    if (value < 1 || value > 24) return;
    this.hoursCountChange.emit(value);
  }

  stepHoursCount(change: -1 | 1): void {
    const draftValue = this.hoursCountDraft?.trim()
      ? Number(this.hoursCountDraft)
      : this.hoursCount;
    const currentValue = Number.isInteger(draftValue) && draftValue >= 1 && draftValue <= 24
      ? draftValue
      : this.hoursCount;
    const value = Math.max(1, Math.min(24, currentValue + change));
    this.hoursCountDraft = null;
    this.hoursCountChange.emit(value);
  }

  getDayCountInputValue(day: string): string {
    return this.dayCountDrafts[day] ?? String(this.getDayCount(day));
  }

  onDayCountDraftInput(day: string, event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.dayCountDrafts[day] = event.target.value;
    }
  }

  commitDayCount(day: string): void {
    const draft = this.dayCountDrafts[day];
    if (draft === undefined) return;
    delete this.dayCountDrafts[day];
    if (!/^\d+$/.test(draft)) return;
    const value = Number(draft);
    if (value < 0 || value > 24) return;
    this.dayCountChange.emit({ day, value });
  }

  stepDayCount(day: string, change: -1 | 1): void {
    const draft = this.dayCountDrafts[day];
    const draftValue = draft?.trim() ? Number(draft) : this.getDayCount(day);
    const currentValue = Number.isInteger(draftValue) && draftValue >= 0 && draftValue <= 24
      ? draftValue
      : this.getDayCount(day);
    const value = Math.max(0, Math.min(24, currentValue + change));
    delete this.dayCountDrafts[day];
    this.dayCountChange.emit({ day, value });
  }

  get planLearnCategories(): readonly PlanCategory[] {
    return this.categories.map((category) => ({
      id: String(category.id),
      name: category.label,
    }));
  }

  get planLearnSubjects(): readonly PlanSubject[] {
    return this.tasks.map((task) => ({
      id: String(task.id),
      categoryId: String(task.category_id),
      name: task.title,
      color: task.color,
    }));
  }

  get planLearnDays(): readonly PlanDay[] {
    return this.selectedDays.map((day) => ({ id: day, name: day }));
  }

  get planLearnTimeSlots(): readonly PlanTimeSlot[] {
    return this.hours.map((hour, index) => ({
      id: String(index + 1),
      start: hour.start_time,
      end: hour.end_time,
      label: `${index + 1}.`,
    }));
  }

  planLearnDaysForDay(day: string): readonly PlanDay[] {
    return [{ id: day, name: day }];
  }

  planLearnTimeSlotsForDay(day: string): readonly PlanTimeSlot[] {
    return (this.dayHours[day] ?? []).map((hour, index) => ({
      id: String(index + 1),
      start: hour.start_time,
      end: hour.end_time,
      label: `${index + 1}.`,
    }));
  }

  get planLearnEntries(): readonly PlanEntry[] {
    return this.selectedDays.flatMap((day) => this.planLearnEntriesForDay(day));
  }

  planLearnEntriesForDay(day: string): readonly PlanEntry[] {
    return (this.activitySubjects[day] ?? [])
      .map((taskId, index) => taskId > 0 ? ({
        dayId: day,
        timeSlotId: String(index + 1),
        subjectId: String(taskId),
      }) : null)
      .filter((entry): entry is PlanEntry => entry !== null);
  }

  onPlanEntryChange(change: PlanEntryChange): void {
    const taskId = change.subjectId === null ? null : Number(change.subjectId);
    if (taskId !== null && !this.tasks.some((task) => task.id === taskId)) {
      console.error('Die Plan-Lernansicht hat einen unbekannten Task gemeldet:', change);
      return;
    }
    this.setActivity(change.dayId, Number(change.timeSlotId), taskId);
  }

  setActivity(day: string, period: number, taskId: number | null): void {
    const values = [...(this.activitySubjects[day] ?? [])];
    values[period - 1] = taskId ?? 0;
    this.activitySubjectsChange.emit({
      ...this.activitySubjects,
      [day]: values,
    });
  }
}
