import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarService, User, Reward, TimeBlock } from '../../../services/calendar.service';

@Component({
  selector: 'app-reward-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reward-dashboard.component.html',
  styleUrl: './reward-dashboard.component.css'
})
export class RewardDashboardComponent implements OnChanges {
  @Input() user: User | null = null;
  @Input() activeRewards: Reward[] = [];
  @Output() closeDashboard = new EventEmitter<void>();
  @Output() adminPageOpened = new EventEmitter<void>();
  @ViewChild('fireworksCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  public todaysBlocks: TimeBlock[] = [];
  public countdownActive = false;
  public countdownTime = 600;
  public windowState: 'ZENTRIERT' | 'KIPP' = 'ZENTRIERT';
  public mediaTimePercent = 100;
  private intervalId: any = null;

  constructor(public calendarService: CalendarService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.user) {
      this.calendarService.blocks$.subscribe((blocks: TimeBlock[]) => {
        // Filtert die Termine für die heutige TÜV-Tagesprüfung heraus
        this.todaysBlocks = blocks.filter((b: TimeBlock) => b.day_of_week === 'Montag');
      });
    }
  }

  startPreCheckFailed(): void {
    if (this.countdownActive) return;
    this.countdownActive = true;
    this.windowState = 'KIPP';
    this.countdownTime = 600;

    this.intervalId = setInterval(() => {
      if (this.countdownTime > 0) {
        this.countdownTime--;
        this.mediaTimePercent = (this.countdownTime / 600) * 100;
      } else {
        this.stopCountdown();
      }
    }, 1000);
  }

  finalTuevPassed(): void {
    if (!this.user) return;
    this.stopCountdown();
    this.windowState = 'ZENTRIERT';
    this.mediaTimePercent = 100;

    this.calendarService.passTuev(this.user.id).subscribe(() => {
      this.triggerFireworks();
    });
  }

  claimReward(reward: Reward): void {
    if (!this.user) return;
    this.calendarService.claimReward(this.user.id, reward.id).subscribe({
      next: () => this.triggerFireworks(),
      error: (err: any) => alert(err.error?.detail || 'Mangelnde Sterne im Sparschwein!')
    });
  }

  private stopCountdown(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.countdownActive = false;
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  private triggerFireworks(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';

    let particles: any[] = [];
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        dx: (Math.random() - 0.5) * 12,
        dy: (Math.random() - 0.5) * 12,
        size: Math.random() * 4 + 2,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        alpha: 1
      });
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(248, 249, 250, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      particles.forEach((p, idx) => {
        p.x += p.dx;
        p.y += p.dy;
        p.dy += 0.05;
        p.alpha -= 0.01;
        
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (p.alpha <= 0) particles.splice(idx, 1);
      });

      if (particles.length > 0) {
        requestAnimationFrame(animate);
      } else {
        canvas.style.display = 'none';
      }
    };
    animate();
  }
}
