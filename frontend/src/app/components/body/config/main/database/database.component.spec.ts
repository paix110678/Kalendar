import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, DatabaseTableData } from '../../../../../services/api.service';
import { ToastService } from '../../../../../services/toast.service';
import { DatabaseComponent } from './database.component';

describe('DatabaseComponent', () => {
  let fixture: ComponentFixture<DatabaseComponent>;

  const tableData: DatabaseTableData = {
    columns: ['id', 'label'],
    rows: [{ id: 8, label: 'Vorher' }],
    primary_key: ['id'],
    rowid_column: null,
  };
  const getTableData = vi.fn(() => of(tableData));
  const updateTableRow = vi.fn(() => of(undefined));
  const deleteTableRow = vi.fn(() => of(undefined));

  beforeEach(async () => {
    getTableData.mockClear();
    updateTableRow.mockClear();
    deleteTableRow.mockClear();
    await TestBed.configureTestingModule({
      imports: [DatabaseComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getDatabaseBackups: vi.fn(() => of({ backups: [], errors: [] })),
            getTableData,
            updateTableRow,
            deleteTableRow,
          },
        },
        { provide: ToastService, useValue: { show: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DatabaseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('updates the selected row using its primary key', () => {
    const component = fixture.componentInstance;
    component.openTableContent('categories');
    component.beginRowEdit(0, tableData.rows[0]);
    component.editRowValues['label'] = 'Geändert';

    component.saveRow(0, tableData.rows[0]);

    expect(updateTableRow).toHaveBeenCalledWith(
      'categories',
      { id: 8 },
      { id: 8, label: 'Geändert' },
    );
    expect(component.editingRowIndex).toBeNull();
  });

  it('deletes only the selected row after confirmation', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const component = fixture.componentInstance;
    component.openTableContent('categories');

    component.deleteRow(0, tableData.rows[0]);

    expect(deleteTableRow).toHaveBeenCalledWith('categories', { id: 8 });
    vi.unstubAllGlobals();
  });
});
