import { Component, HostListener, OnDestroy } from '@angular/core';
import { DiscordService } from './services/discord.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnDestroy {
  title = 'Fléchettes mobile';

  level = 1;
  dartsLeft = 3;
  totalScore = 0;
  lastShotScore = 0;
  lastShotDetail = 'Aucun tir effectué.';
  statusMessage = 'Place le curseur sur la cible, appuie sur Espace pour charger et relâche pour tirer.';
  playerName = 'Anonyme';
  bestScore = 260;
  bestHolder = 'whyv';
  isSharing = false;
  sessionToken: string | null = null;

  aimX = 0.5;
  aimY = 0.5;
  showLastShot = false;
  lastShotX = 0.5;
  lastShotY = 0.5;
  lastShotAngle = 0;

  targetX = 0.5;
  targetY = 0.5;
  targetDirX = 0.55;
  targetDirY = 0.45;
  targetAnimId?: number;
  lastFrameTime = 0;

  isCharging = false;
  chargePower = 0;
  private chargeInterval?: number;
  private spacePressed = false;

  constructor(private discordService: DiscordService) {
    this.startTargetMovement();
    // read token and user from URL if present
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      if (t) this.sessionToken = t;
      const u = params.get('user');
      if (u) this.playerName = decodeURIComponent(u);
    } catch (e) {
      this.sessionToken = null;
    }
  }

  onTargetMove(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.aimX = Math.min(1, Math.max(0, x));
    this.aimY = Math.min(1, Math.max(0, y));
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      event.preventDefault();
      if (!this.spacePressed) {
        this.spacePressed = true;
        this.startCharge();
      }
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      event.preventDefault();
      this.spacePressed = false;
      this.stopCharge();
    }
  }

  startCharge(): void {
    if (this.dartsLeft <= 0) {
      this.statusMessage = 'La partie est terminée. Clique sur Recommencer.';
      return;
    }
    if (this.isCharging) {
      return;
    }

    this.isCharging = true;
    this.chargePower = 0;
    this.statusMessage = 'Chargement du tir... Appuie sur Espace pour relâcher.';

    this.chargeInterval = window.setInterval(() => {
      this.chargePower = Math.min(120, this.chargePower + 4);
      if (this.chargePower >= 120) {
        this.releaseShot();
      }
    }, 30);
  }

  stopCharge(): void {
    if (!this.isCharging) {
      return;
    }
    this.releaseShot();
  }

  private releaseShot(): void {
    window.clearInterval(this.chargeInterval);
    this.isCharging = false;

    if (this.dartsLeft <= 0) {
      this.statusMessage = 'La partie est terminée. Clique sur Recommencer.';
      return;
    }

    const targetCenterX = this.targetX;
    const targetCenterY = this.targetY;
    const dx = this.aimX - targetCenterX;
    const dy = this.aimY - targetCenterY;

    const drift = Math.max(0, 0.15 - this.level * 0.008 - this.chargePower / 1200);
    const randomOffsetX = (Math.random() - 0.5) * drift;
    const randomOffsetY = (Math.random() - 0.5) * drift;

    const powerOvershoot = Math.max(0, (this.chargePower - 80) / 80);
    const overshootX = dx * powerOvershoot * 0.9;
    const overshootY = dy * powerOvershoot * 0.9;

    let hitX = this.aimX + randomOffsetX + overshootX;
    let hitY = this.aimY + randomOffsetY + overshootY;
    hitX = Math.min(1, Math.max(0, hitX));
    hitY = Math.min(1, Math.max(0, hitY));

    const finalDx = hitX - targetCenterX;
    const finalDy = hitY - targetCenterY;
    const finalDistance = Math.sqrt(finalDx * finalDx + finalDy * finalDy);

    const score = this.calculateScore(finalDistance, this.chargePower);

    this.totalScore += score;
    this.lastShotScore = score;
    this.lastShotDetail = `Niveau ${this.level}, distance cible ${(finalDistance * 100).toFixed(1)}%, puissance ${this.chargePower}%`;
    this.lastShotX = hitX;
    this.lastShotY = hitY;
    this.lastShotAngle = Math.atan2(finalDy, finalDx) * (180 / Math.PI) + 90;
    this.showLastShot = true;
    this.dartsLeft -= 1;

    if (this.dartsLeft === 0) {
      if (this.level < 5) {
        this.level += 1;
        this.dartsLeft = 3;
        this.statusMessage = `Niveau ${this.level} : la cible bouge plus vite maintenant.`;
      } else {
        this.statusMessage = `Partie terminée ! Score final : ${this.totalScore} points.`;
      }
    } else {
      this.statusMessage = `Tir effectué: ${score} points. ${this.dartsLeft} fléchettes restantes.`;
    }

    this.chargePower = 0;
  }

  private calculateScore(distance: number, power: number): number {
    const radius = 0.35;
    const normalized = Math.min(1, distance / radius);
    const raw = Math.round((1 - normalized) * 100);
    const penalty = Math.max(0, power - 90);
    const score = raw - Math.round(penalty / 3);
    return Math.max(0, Math.min(100, score));
  }

  resetGame(): void {
    this.level = 1;
    this.dartsLeft = 3;
    this.totalScore = 0;
    this.lastShotScore = 0;
    this.lastShotDetail = 'Aucun tir effectué.';
    this.statusMessage = 'Nouvelle partie : vise la cible avec la souris, appuie sur Espace pour charger.';
    this.showLastShot = false;
    this.chargePower = 0;
    this.isCharging = false;
    this.spacePressed = false;
    this.playerName = 'Anonyme';
    this.targetX = 0.5;
    this.targetY = 0.5;
    this.targetDirX = 0.55;
    this.targetDirY = 0.45;
    window.clearInterval(this.chargeInterval);
  }

  private startTargetMovement(): void {
    this.lastFrameTime = performance.now();
    this.targetAnimId = requestAnimationFrame(this.animateTarget.bind(this));
  }

  private animateTarget(time: number): void {
    const delta = Math.min(50, time - this.lastFrameTime);
    this.lastFrameTime = time;

    const speed = 0.00015 + this.level * 0.00008;
    this.targetX += this.targetDirX * speed * delta;
    this.targetY += this.targetDirY * speed * delta;

    if (this.targetX < 0.2 || this.targetX > 0.8) {
      this.targetDirX *= -1;
      this.targetX = Math.min(0.8, Math.max(0.2, this.targetX));
    }
    if (this.targetY < 0.2 || this.targetY > 0.8) {
      this.targetDirY *= -1;
      this.targetY = Math.min(0.8, Math.max(0.2, this.targetY));
    }

    if (Math.random() < 0.02 + this.level * 0.01) {
      const angle = Math.random() * Math.PI * 2;
      this.targetDirX = Math.cos(angle);
      this.targetDirY = Math.sin(angle);
    }

    this.targetX = Math.min(0.85, Math.max(0.15, this.targetX));
    this.targetY = Math.min(0.85, Math.max(0.15, this.targetY));

    this.targetAnimId = requestAnimationFrame(this.animateTarget.bind(this));
  }

  async shareDiscord(): Promise<void> {
    if (this.totalScore <= 0) {
      this.statusMessage = 'Joue au moins une partie avant de partager ton score.';
      return;
    }

    this.isSharing = true;
    const name = this.playerName.trim() || 'Anonyme';
    const recordText = this.totalScore > this.bestScore
      ? `Nouveau record ! ${this.totalScore} par ${name}`
      : `${this.bestScore} par ${this.bestHolder}`;

    if (this.totalScore > this.bestScore) {
      this.bestScore = this.totalScore;
      this.bestHolder = name;
    }

    const message = `${name} a fait ${this.totalScore} points sur le whyvgame (record: ${recordText})`;

    let result: string;
    if (this.sessionToken) {
      result = await this.discordService.shareScore(this.sessionToken, name, this.totalScore);
    } else {
      result = await this.discordService.notifyDiscord(message);
    }
    this.statusMessage = `Discord : ${result}`;
    this.isSharing = false;
  }

  ngOnDestroy(): void {
    window.clearInterval(this.chargeInterval);
    if (this.targetAnimId) {
      cancelAnimationFrame(this.targetAnimId);
    }
  }
}
