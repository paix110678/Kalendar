import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorPickerComponent } from './color-picker.component';

describe('ColorPickerComponent', () => {
  let fixture: ComponentFixture<ColorPickerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ColorPickerComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ColorPickerComponent);
    fixture.componentRef.setInput('value', '#e03131');
    fixture.detectChanges();
  });

  it('opens the native color palette directly from Custom', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.palette-tabs button:not(.palette-close)'),
    ) as HTMLButtonElement[];
    const colorInput = fixture.nativeElement.querySelector('.native-color-input') as HTMLInputElement;
    const openPalette = vi.spyOn(colorInput, 'click');

    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Standard',
      'Eigene',
      'Custom',
    ]);
    buttons[2].click();
    expect(openPalette).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.custom-panel')).toBeNull();
  });

  it('closes the palette with the close button and centers the color grid', () => {
    const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    const closeButton = fixture.nativeElement.querySelector('.palette-close') as HTMLButtonElement;
    closeButton.click();

    expect(details.open).toBe(false);
    expect(getComputedStyle(fixture.nativeElement.querySelector('.standard-colors')).justifyContent)
      .toBe('center');
  });
});
