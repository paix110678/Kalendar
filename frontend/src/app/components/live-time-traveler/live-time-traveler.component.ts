import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService } from '../../services/calendar.service';

@Component({
  selector: 'app-live-time-traveler',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- BEHOBEN: Das Badge und die Linie nutzen jetzt [style.top.px], um reaktiv jede Minute mitzuwandern! -->
    <!-- Formel: 45px (Header-Abstand) + (Zeilen-Index * 4.5px Zeilenhöhe) -->
    <div class="live-axis-time-badge" 
         [style.top.px]="45 + (liveTimeGridRow * calendarService.ROW_HEIGHT_PIXELS)">
      {{ liveTimeShort }}
    </div>
    
    <!-- Die durchgezogene rote Echtzeitlinie wandert synchron im selben Pixel-Takt mit -->
    <div class="current-time-line-tracker-solid" 
         [style.top.px]="45 + (liveTimeGridRow * calendarService.ROW_HEIGHT_PIXELS)">
    </div>
  `,
  styles: [`
    /* WOFÜR: Positioniert das rote Uhrzeit-Badge links reaktiv auf der dynamischen Höhe */
    .live-axis-time-badge { 
      position: absolute; 
      left: 0px; 
      width: 54px;
      height: 22px;
      transform: translateY(-50%); /* Zentriert die Text-Kapsel perfekt vertikal auf der roten Linie */
      background: #e03131; 
      color: white; 
      font-size: 12px; 
      font-weight: 900; 
      border-radius: 4px; 
      z-index: 120; 
      font-family: system-ui, sans-serif; 
      box-shadow: 0 2px 5px rgba(224, 49, 49, 0.4); 
      display: flex;
      align-items: center;
      justify-content: center;
      transition: top 0.5s ease-in-out; /* Macht das Wandern der Linie geschmeidig */
    }

    /* WOFÜR: Die rote Trennlinie schneidet glatt quer ab dem Spaltenbett (Breite: 80px Offset der Achse) */
    .current-time-line-tracker-solid {
      height: 2px;
      background-color: #e03131;
      position: absolute;
      left: 80px !important; /* Beginnt exakt nach den 80px der Zeitleistenbeschriftung */
      right: 0 !important;
      width: calc(100% - 80px) !important;
      z-index: 100;
      pointer-events: none;
      box-shadow: 0 1px 5px rgba(224, 49, 49, 0.5);
      transition: top 0.5s ease-in-out; /* Synchronisiert das Gleiten der Linie */
    }
  `]
})
export class LiveTimeTravelerComponent implements OnInit, OnDestroy {
  public liveTimeShort = '00:00';
  public liveTimeGridRow = 1;
  private timerId: any = null;

  constructor(public calendarService: CalendarService) {
    // ERZWUNGEN: Berechnet den Startpunkt bereits vor dem ersten Rendern, damit die Linie nicht oben klemmt!
    this.recalculateLiveRow();
  }

  ngOnInit(): void {
    this.recalculateLiveRow();
    // Minutentakt reicht völlig aus und schont die CPU deines Laptops
    this.timerId = setInterval(() => this.recalculateLiveRow(), 60000);
  }

  public recalculateLiveRow(): void {
    const now = new Date();
    this.liveTimeShort = `${now.getHours() < 10 ? '0' : ''}${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
    
    if (now.getHours() < this.calendarService.START_HOUR || now.getHours() >= this.calendarService.END_HOUR) {
      this.liveTimeGridRow = 1;
      return;
    }
    
    // Berechnet die exakte 5-Minuten-Rasterzeile anhand deiner Service-Konstanten
    this.liveTimeGridRow = Math.floor(((now.getHours() - this.calendarService.START_HOUR) * 60 + now.getMinutes()) / 5) + 1;
  }

  ngOnDestroy(): void { 
    if (this.timerId) clearInterval(this.timerId); 
  }
}
