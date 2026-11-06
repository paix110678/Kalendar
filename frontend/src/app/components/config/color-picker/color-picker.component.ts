import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

@Component({
  selector: 'app-color-picker',
  standalone: true,
  templateUrl: './color-picker.component.html',
  styleUrl: './color-picker.component.css',
})
export class ColorPickerComponent implements OnInit {
  private readonly customColorsStorageKey = 'calendar-created-colors';

  @Input() value = '#228be6';
  @Output() valueChange = new EventEmitter<string>();

  activeTab: 'standard' | 'created' = 'standard';
  createdColors: string[] = [];

  readonly standardColors = [
    { name: 'Weiß', value: '#ffffff' },
    { name: 'Elfenbein', value: '#fff9db' },
    { name: 'Grau', value: '#adb5bd' },
    { name: 'Hellgelb', value: '#ffec99' },
    { name: 'Gold', value: '#ffd43b' },
    { name: 'Hellorange', value: '#ffe8cc' },
    { name: 'Orange', value: '#ffc078' },
    { name: 'Ocker', value: '#e67700' },
    { name: 'Rot', value: '#fa5252' },
    { name: 'Dunkelrot', value: '#a61e4d' },
    { name: 'Hellrosa', value: '#ffdeeb' },
    { name: 'Rosa', value: '#f783ac' },
    { name: 'Lavendel', value: '#e5dbff' },
    { name: 'Violett', value: '#b197fc' },
    { name: 'Dunkelviolett', value: '#7048e8' },
    { name: 'Hellblau', value: '#d0ebff' },
    { name: 'Blau', value: '#74c0fc' },
    { name: 'Dunkelblau', value: '#1864ab' },
    { name: 'Indigo', value: '#4263eb' },
    { name: 'Hellcyan', value: '#c5f6fa' },
    { name: 'Cyan', value: '#66d9e8' },
    { name: 'Petrol', value: '#0b7285' },
    { name: 'Türkis', value: '#63e6be' },
    { name: 'Mint', value: '#c3fae8' },
    { name: 'Hellgrün', value: '#d8f5a2' },
    { name: 'Limette', value: '#a9e34b' },
    { name: 'Grün', value: '#69db7c' },
    { name: 'Dunkelgrün', value: '#2f9e44' },
    { name: 'Dunkelgrau', value: '#495057' },
    { name: 'Schwarz', value: '#000000' },
  ];

  ngOnInit(): void {
    try {
      const storedColors = localStorage.getItem(this.customColorsStorageKey);
      if (!storedColors) return;
      const parsed: unknown = JSON.parse(storedColors);
      if (!Array.isArray(parsed) || !parsed.every((color) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color))) {
        console.error('Gespeicherte eigene Farben haben ein ungültiges Format.');
        return;
      }
      this.createdColors = [...new Set(parsed.map((color: string) => color.toLowerCase()))];
    } catch (error: unknown) {
      console.error('Gespeicherte eigene Farben konnten nicht gelesen werden:', error);
    }
  }

  onPaletteChange(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      const color = event.target.value.toLowerCase();
      this.valueChange.emit(color);
      if (!this.createdColors.includes(color)) {
        this.createdColors = [...this.createdColors, color];
        this.persistCreatedColors();
      }
    }
  }

  selectStandardColor(value: string, event: Event): void {
    this.valueChange.emit(value);
    if (event.currentTarget instanceof HTMLButtonElement) {
      const palette = event.currentTarget.closest('details');
      if (palette) palette.open = false;
    }
  }

  setActiveTab(tab: 'standard' | 'created'): void {
    this.activeTab = tab;
  }

  private persistCreatedColors(): void {
    try {
      localStorage.setItem(this.customColorsStorageKey, JSON.stringify(this.createdColors));
    } catch (error: unknown) {
      console.error('Eigene Farben konnten nicht gespeichert werden:', error);
    }
  }
}
