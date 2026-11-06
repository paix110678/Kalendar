import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-title-back-header',
  standalone: true,
  templateUrl: './title-back-header.component.html',
  styleUrl: './title-back-header.component.css',
})
export class TitleBackHeaderComponent {
  @Input() title = '';
  @Output() back = new EventEmitter<void>();
}
