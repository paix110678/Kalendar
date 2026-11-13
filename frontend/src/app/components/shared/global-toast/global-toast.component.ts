import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-global-toast',
  standalone: true,
  imports: [AsyncPipe],
  templateUrl: './global-toast.component.html',
  styleUrl: './global-toast.component.css',
})
export class GlobalToastComponent {
  readonly toastService = inject(ToastService);
}
