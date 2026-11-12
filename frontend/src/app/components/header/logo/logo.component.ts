import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './logo.component.html',
  styleUrls: [
    './logo.component.css',
    './logo.component.handy.css',
  ]
})
export class LogoComponent {}
