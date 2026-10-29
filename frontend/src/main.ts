import { bootstrapApplication } from '@angular/platform-browser';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { AppComponent } from './app/app';

registerLocaleData(localeDe);

bootstrapApplication(AppComponent, {
  providers: [{ provide: LOCALE_ID, useValue: 'de-DE' }]
}).catch((err) => console.error(err));
