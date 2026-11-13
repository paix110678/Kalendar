import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogoComponent } from '../logo/logo.component';
import { HeaderAccountActionsComponent } from '../header-account-actions/header-account-actions.component';

@Component({
  selector: 'app-header-brand',
  standalone: true,
  imports: [CommonModule, LogoComponent, HeaderAccountActionsComponent],
  templateUrl: './header-brand.component.html',
  styleUrls: [
    './header-brand.component.css',
    './header-brand.component.handy.css',
  ],
})
export class HeaderBrandComponent {
  @Input() isCapturingScreenshot = false;
  @Output() adminPageOpened = new EventEmitter<void>();
  @Output() errorReportRequested = new EventEmitter<void>();
}
