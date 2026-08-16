import { Component, Input, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface WeatherWidgetConfig {
  live_temp: string;
  high_temp: string;
  low_temp: string;
  live_rain: string;
  weather_city: string;
}

@Component({
  selector: 'app-weather-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weather-widget.component.html',
  styleUrl: './weather-widget.component.css'
})
export class WeatherWidgetComponent implements OnChanges, OnInit, OnDestroy {
  @Input() config!: WeatherWidgetConfig;

  // Ausgelagerte Zeitvariablen direkt in das Widget verlagert
  public liveTimeShort = '18:05';
  public liveDateCustom = 'Do., 13. Aug.';
  private clockTimerId: any = null;

  ngOnInit(): void {
    this.startLiveClock();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Bleibt exakt nach deiner Vorlage erhalten
  }

  private startLiveClock(): void {
    const dateObj = new Date();
    this.liveDateCustom = `${dateObj.toLocaleDateString('de-DE', { weekday: 'short' })}, ${dateObj.getDate()}. ${dateObj.toLocaleDateString('de-DE', { month: 'short' })}`;

    this.clockTimerId = setInterval(() => {
      const now = new Date();
      this.liveTimeShort = `${now.getHours() < 10 ? '0' : ''}${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.clockTimerId) {
      clearInterval(this.clockTimerId);
    }
  }
}
