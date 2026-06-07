import {
  Component, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener,
} from '@angular/core';
import { DiscordService } from '../services/discord.service';

type State = 'title' | 'select' | 'playing' | 'gameover';
type CharId = 'luffy' | 'zoro' | 'sanji';

interface Obs { x: number; y: number; w: number; h: number; type: 'rock' | 'spike' | 'bird'; }
interface Cloud { x: number; y: number; w: number; spd: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; }
interface CharDef {
  name: string; ability: string; desc: string; color: string;
  jumpF: number; maxJ: number; baseSpd: number; scoreMult: number;
}

@Component({
  selector: 'app-one-piece-runner',
  templateUrl: './one-piece-runner.component.html',
  styleUrls: ['./one-piece-runner.component.css'],
})
export class OnePieceRunnerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cv') cvRef!: ElementRef<HTMLCanvasElement>;

  private cv!: HTMLCanvasElement;
  private cx!: CanvasRenderingContext2D;
  private raf!: number;
  private lastT = 0;

  readonly W = 900;
  readonly H = 450;
  readonly GY = 345; // ground Y (feet level)

  state: State = 'title';
  selectedChar: CharId = 'luffy';

  // Share
  playerName = 'Anonyme';
  isSharing = false;
  shareMsg = '';
  shareMsgFade = 0;

  private score = 0;
  private hiScore = +(localStorage.getItem('op-hs') ?? '0');
  private speed = 5;
  private scoreTick = 0;
  private spawnTick = 0;
  private obstacles: Obs[] = [];
  private clouds: Cloud[] = [];
  private particles: Particle[] = [];
  private bgOff = 0;
  private waveOff = 0;
  private animT = 0;
  private deathT = 0;
  private islandOff: number[] = [];
  private milestoneMsg = '';
  private milestoneFade = 0;
  private screenShake = 0;

  private pl = { x: 130, y: this.GY, vy: 0, jumps: 0, grounded: true, wasGrounded: true, anim: 0 };

  readonly chars: Record<CharId, CharDef> = {
    luffy: {
      name: 'Monkey D. Luffy', ability: 'Double Saut ・ Gear 2', desc: 'Saute 2× plus haut!',
      color: '#EE3333', jumpF: -20, maxJ: 2, baseSpd: 5, scoreMult: 1,
    },
    zoro: {
      name: 'Roronoa Zoro', ability: 'Hyper Vitesse', desc: 'Score x2 + vite!',
      color: '#22BB44', jumpF: -13, maxJ: 1, baseSpd: 7, scoreMult: 2,
    },
    sanji: {
      name: 'Sanji', ability: 'Ifrit Jambe', desc: 'Immunisé aux pics!',
      color: '#4488EE', jumpF: -13, maxJ: 1, baseSpd: 5, scoreMult: 1,
    },
  };

  constructor(private discordService: DiscordService) {}

  // ─── Lifecycle ─────────────────────────────────────────────────

  ngAfterViewInit() {
    this.cv = this.cvRef.nativeElement;
    this.cv.width = this.W;
    this.cv.height = this.H;
    this.cx = this.cv.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      this.clouds.push({ x: Math.random() * this.W, y: 25 + Math.random() * 130, w: 70 + Math.random() * 100, spd: 0.35 + Math.random() * 0.45 });
    }
    for (let i = 0; i < 5; i++) this.islandOff.push(Math.random() * (this.W + 300));
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  ngOnDestroy() { cancelAnimationFrame(this.raf); }

  // ─── Input ─────────────────────────────────────────────────────

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (this.state === 'title' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault(); this.state = 'select';
    } else if (this.state === 'select') {
      const ids: CharId[] = ['luffy', 'zoro', 'sanji'];
      const i = ids.indexOf(this.selectedChar);
      if (e.code === 'ArrowLeft')  { e.preventDefault(); this.selectedChar = ids[(i + 2) % 3]; }
      if (e.code === 'ArrowRight') { e.preventDefault(); this.selectedChar = ids[(i + 1) % 3]; }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.startGame(); }
    } else if (this.state === 'playing') {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); this.doJump(); }
    } else if (this.state === 'gameover') {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.startGame(); }
      if (e.code === 'Escape') { this.state = 'select'; }
    }
  }

  onCanvasClick(e: MouseEvent) {
    if (this.state === 'title') { this.state = 'select'; return; }
    if (this.state === 'select') { this.handleSelectClick(e); return; }
    if (this.state === 'playing') { this.doJump(); return; }
    if (this.state === 'gameover') { this.startGame(); }
  }

  onTouch(e: TouchEvent) {
    e.preventDefault();
    if (this.state === 'title')  { this.state = 'select'; return; }
    if (this.state === 'playing') { this.doJump(); return; }
    if (this.state === 'gameover') { this.startGame(); }
  }

  async shareRunnerScore() {
    if (this.isSharing) return;
    this.isSharing = true;
    const name = this.playerName.trim() || 'Anonyme';
    const record = this.hiScore;
    const msg = `⚓ ${name} a scoré **${this.score} pts** sur le One Piece Runner! (Record: ${record})`;
    const result = await this.discordService.notifyDiscord(msg);
    this.shareMsg = result;
    this.shareMsgFade = 1;
    this.isSharing = false;
    setTimeout(() => this.shareMsgFade = 0, 3500);
  }

  // ─── Game Logic ─────────────────────────────────────────────────

  private handleSelectClick(e: MouseEvent) {
    const rect = this.cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (this.W / rect.width);
    const ids: CharId[] = ['luffy', 'zoro', 'sanji'];
    const cw = 220;
    const sx = this.W / 2 - (cw * 3 + 40) / 2;
    for (let i = 0; i < 3; i++) {
      const cx = sx + i * (cw + 20);
      if (mx >= cx && mx <= cx + cw) {
        if (this.selectedChar === ids[i]) this.startGame();
        else this.selectedChar = ids[i];
        return;
      }
    }
  }

  private doJump() {
    const c = this.chars[this.selectedChar];
    if (this.pl.jumps < c.maxJ) {
      this.pl.vy = c.jumpF;
      this.pl.jumps++;
      this.pl.grounded = false;
    }
  }

  private startGame() {
    const c = this.chars[this.selectedChar];
    this.score = 0; this.speed = c.baseSpd;
    this.obstacles = []; this.particles = [];
    this.scoreTick = 0; this.spawnTick = 0;
    this.deathT = 0; this.screenShake = 0;
    this.milestoneMsg = ''; this.milestoneFade = 0;
    this.shareMsg = ''; this.shareMsgFade = 0;
    this.pl = { x: 130, y: this.GY, vy: 0, jumps: 0, grounded: true, wasGrounded: true, anim: 0 };
    this.state = 'playing';
  }

  private loop(t: number) {
    const dt = Math.min(t - this.lastT, 50);
    this.lastT = t;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(ts => this.loop(ts));
  }

  private update(_dt: number) {
    this.animT  += 0.018;
    this.waveOff += 0.04;
    this.bgOff  += 0.3;
    if (this.screenShake > 0) this.screenShake -= 0.5;
    if (this.shareMsgFade > 0) this.shareMsgFade -= 0.008;

    for (const cl of this.clouds) {
      cl.x -= cl.spd;
      if (cl.x + cl.w < 0) { cl.x = this.W + 50; cl.y = 25 + Math.random() * 130; cl.w = 70 + Math.random() * 100; }
    }
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.28; p.life -= 0.035; }
    this.particles = this.particles.filter(p => p.life > 0);
    if (this.milestoneFade > 0) this.milestoneFade -= 0.01;

    if (this.state !== 'playing') {
      if (this.state === 'gameover') this.deathT += 0.04;
      return;
    }

    // Score
    this.scoreTick++;
    const ch = this.chars[this.selectedChar];
    if (this.scoreTick >= 6) {
      const prev = this.score;
      this.score += Math.ceil(ch.scoreMult);
      this.checkMilestone(prev, this.score);
      this.scoreTick = 0;
    }
    this.speed = ch.baseSpd + this.score * 0.008;

    // Player physics
    this.pl.wasGrounded = this.pl.grounded;
    this.pl.vy  += 0.78;
    this.pl.y   += this.pl.vy;
    this.pl.anim += 0.22;
    if (this.pl.y >= this.GY) {
      this.pl.y = this.GY; this.pl.vy = 0; this.pl.jumps = 0; this.pl.grounded = true;
    } else {
      this.pl.grounded = false;
    }
    // Landing dust
    if (!this.pl.wasGrounded && this.pl.grounded) this.spawnLandDust();

    // Spawn
    this.spawnTick++;
    const interval = Math.max(30, 110 - this.score * 0.04);
    if (this.spawnTick >= interval) { this.spawnObs(); this.spawnTick = 0; }

    for (const o of this.obstacles) o.x -= this.speed;
    this.obstacles = this.obstacles.filter(o => o.x + o.w > -20);

    for (const o of this.obstacles) {
      if (o.type === 'spike' && this.selectedChar === 'sanji') continue;
      if (this.hit(o)) { this.die(); return; }
    }
  }

  private checkMilestone(prev: number, next: number) {
    const ms     = [100, 300, 500, 1000, 2000, 5000];
    const labels = ['Sugoi! 🎉', 'Nakama! ⚓', 'Woooooo!', 'Capitaine! 👑', 'Roi des Pirates! ⚔️', '★ PIRATE LEGEND ★'];
    for (let i = 0; i < ms.length; i++) {
      if (prev < ms[i] && next >= ms[i]) { this.milestoneMsg = labels[i]; this.milestoneFade = 1; }
    }
  }

  private spawnObs() {
    const rand = Math.random();
    let type: Obs['type'], w: number, h: number, y: number;
    if (this.score > 150 && rand < 0.23) {
      type = 'bird'; w = 90; h = 55; y = this.GY - 115 - Math.random() * 55;
    } else if (rand < 0.48) {
      type = 'rock';
      w = 55 + Math.random() * 35; h = 60 + Math.random() * 45; y = this.GY - h + 4;
    } else {
      type = 'spike';
      w = 50 + Math.random() * 25; h = 95 + Math.random() * 45; y = this.GY - h + 4;
    }
    this.obstacles.push({ x: this.W + 20, y, w, h, type });

    if (this.score > 60 && Math.random() < 0.27 && this.obstacles.length < 4) {
      const last = this.obstacles[this.obstacles.length - 1];
      this.obstacles.push({ ...last, x: last.x + last.w + 14 + Math.random() * 28 });
    }
  }

  private hit(o: Obs): boolean {
    const m = 11, pw = 36, ph = 60;
    const px = this.pl.x - pw/2 + m, py = this.pl.y - ph + m;
    return px < o.x+o.w-m && px+pw-2*m > o.x+m && py < o.y+o.h-m && py+ph-2*m > o.y+m;
  }

  private die() {
    if (this.score > this.hiScore) { this.hiScore = this.score; localStorage.setItem('op-hs', String(this.hiScore)); }
    this.screenShake = 14;
    const colors = ['#FF3333', '#FFD700', '#FF6600', '#FF88AA', '#FF4400'];
    for (let i = 0; i < 28; i++) {
      const a = Math.random()*Math.PI*2, spd = 2 + Math.random()*7;
      this.particles.push({ x: this.pl.x, y: this.pl.y-45, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd-4, life: 1, size: 5+Math.random()*10, color: colors[Math.floor(Math.random()*5)] });
    }
    this.state = 'gameover';
  }

  private spawnLandDust() {
    const dustColors = ['#8BC34A','#AED581','#DCE775'];
    for (let i = 0; i < 10; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.push({
        x: this.pl.x + (Math.random()-0.5)*20,
        y: this.GY,
        vx: side*(0.8 + Math.random()*2),
        vy: -(0.5 + Math.random()*1.5),
        life: 0.55,
        size: 3 + Math.random()*4,
        color: dustColors[Math.floor(Math.random()*3)],
      });
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  private render() {
    const c = this.cx;
    c.save();

    const shX = this.screenShake > 0 ? (Math.random()-0.5)*this.screenShake : 0;
    const shY = this.screenShake > 0 ? (Math.random()-0.5)*this.screenShake*0.5 : 0;
    if (this.screenShake > 0) c.translate(shX, shY);

    c.clearRect(-10, -10, this.W+20, this.H+20);
    this.drawBg();

    if (this.state === 'title')  { this.drawTitle(); c.restore(); return; }
    if (this.state === 'select') { this.drawSelect(); c.restore(); return; }

    this.drawObstacles();
    this.drawChar(this.pl.x, this.pl.y, this.pl.anim, !this.pl.grounded, this.pl.jumps);
    this.drawParticles();
    this.drawHUD();
    if (this.state === 'gameover') this.drawGameOver();

    c.restore();
  }

  // ─── Background ─────────────────────────────────────────────────

  private drawBg() {
    const c = this.cx;

    // Grand Line Sunset Sky
    const sky = c.createLinearGradient(0, 0, 0, this.GY);
    sky.addColorStop(0,    '#060030');
    sky.addColorStop(0.20, '#1a006a');
    sky.addColorStop(0.42, '#5c1280');
    sky.addColorStop(0.64, '#c84500');
    sky.addColorStop(0.80, '#ff6600');
    sky.addColorStop(1,    '#ff2200');
    c.fillStyle = sky;
    c.fillRect(0, 0, this.W, this.GY);

    // Stars (upper portion only)
    c.save();
    for (let i = 0; i < 42; i++) {
      const sx = (i*113+17) % this.W;
      const sy = (i*67+11)  % (this.GY * 0.38);
      c.globalAlpha = (0.3+0.7*Math.sin(this.animT*2.1+i))*0.85;
      c.fillStyle = '#fff';
      c.fillRect(sx, sy, 1+(i%3)*0.5, 1+(i%3)*0.5);
    }
    c.globalAlpha = 1;
    c.restore();

    // Large sun disc at horizon
    c.save();
    const sunX = this.W * 0.72, sunY = this.GY * 0.90;
    const sunG = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, 65);
    sunG.addColorStop(0,   'rgba(255,235,80,0.95)');
    sunG.addColorStop(0.35,'rgba(255,150,20,0.75)');
    sunG.addColorStop(0.7, 'rgba(255,80,0,0.4)');
    sunG.addColorStop(1,   'rgba(255,40,0,0)');
    c.fillStyle = sunG;
    c.beginPath(); c.arc(sunX, sunY, 65, 0, Math.PI*2); c.fill();
    c.restore();

    // Thousand Sunny silhouette
    const sunnyX = ((this.islandOff[0] + this.bgOff * 0.12) % (this.W + 350)) - 170;
    this.drawThousandSunny(sunnyX, this.GY - 28);

    // Other island silhouettes
    c.save();
    c.fillStyle = 'rgba(10,4,40,0.60)';
    for (let i = 1; i < 5; i++) {
      const ix = ((this.islandOff[i] + this.bgOff * 0.15) % (this.W+260)) - 130;
      const iy = this.GY - 48 - (i%3)*16;
      const iw = 95+(i*43)%95, ih = 48+(i*29)%55;
      c.beginPath();
      c.moveTo(ix, iy+ih);
      c.quadraticCurveTo(ix+iw*0.3, iy, ix+iw*0.5, iy);
      c.quadraticCurveTo(ix+iw*0.7, iy, ix+iw, iy+ih);
      c.closePath(); c.fill();
    }
    c.restore();

    // Sunset clouds (tinted orange/pink)
    for (const cl of this.clouds) this.drawCloud(cl.x, cl.y, cl.w);

    // Ground - thick earthy strip from GY to bottom
    const grd = c.createLinearGradient(0, this.GY, 0, this.H);
    grd.addColorStop(0,    '#5CB85C');
    grd.addColorStop(0.06, '#4CAF50');
    grd.addColorStop(0.22, '#388E3C');
    grd.addColorStop(0.42, '#795548');
    grd.addColorStop(0.68, '#5D4037');
    grd.addColorStop(1,    '#3E2723');
    c.fillStyle = grd;
    c.fillRect(0, this.GY, this.W, this.H - this.GY);

    // Grass edge highlight
    c.strokeStyle = '#81C784'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, this.GY); c.lineTo(this.W, this.GY); c.stroke();

    // Grass tufts
    c.strokeStyle = '#66BB6A'; c.lineWidth = 1.5;
    const gap2 = 38, tOff = (this.bgOff*2) % gap2;
    for (let t = -1; t * gap2 - tOff < this.W + gap2; t++) {
      const tx = t * gap2 - tOff;
      const h2 = 4 + Math.sin(tx*0.35)*2;
      c.beginPath();
      c.moveTo(tx-4, this.GY); c.lineTo(tx, this.GY-h2); c.lineTo(tx+4, this.GY);
      c.stroke();
    }

    // Ground dashes (speed indicator)
    if (this.state === 'playing' || this.state === 'gameover') {
      c.strokeStyle = 'rgba(255,255,255,0.11)'; c.lineWidth = 1.5;
      const dsh = 26, gp = 52, off2 = (this.bgOff*3) % (dsh+gp);
      for (let x = -gp+off2; x < this.W+gp; x += dsh+gp) {
        c.beginPath(); c.moveTo(x, this.GY+12); c.lineTo(x+dsh, this.GY+12); c.stroke();
      }
    }

    // High speed red vignette
    if (this.state === 'playing') {
      const sv = Math.min(1, (this.speed - 9) / 14);
      if (sv > 0) {
        const vg = c.createRadialGradient(this.W/2, this.H/2, this.W*0.28, this.W/2, this.H/2, this.W*0.82);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, `rgba(180,0,0,${sv*0.38})`);
        c.fillStyle = vg; c.fillRect(0, 0, this.W, this.H);
      }
    }
  }

  private drawCloud(x: number, y: number, w: number) {
    const c = this.cx; c.save();
    c.globalAlpha = 0.82;
    // Sunset-tinted: warm cream/orange
    const frac = Math.max(0, (y - 60) / (this.GY * 0.5));
    const r = Math.floor(255);
    const g2 = Math.floor(220 - frac * 60);
    const b = Math.floor(180 - frac * 80);
    c.fillStyle = `rgb(${r},${g2},${b})`;
    const e = (ox: number, oy: number, rx: number, ry: number) => { c.beginPath(); c.ellipse(ox,oy,rx,ry,0,0,Math.PI*2); c.fill(); };
    e(x+w*0.5, y, w*0.44, 14); e(x+w*0.28, y+6, w*0.30, 11); e(x+w*0.72, y+6, w*0.30, 11);
    c.restore();
  }

  // ─── Thousand Sunny ─────────────────────────────────────────────

  private drawThousandSunny(x: number, y: number) {
    const c = this.cx; c.save();
    const col = 'rgba(12,5,38,0.62)';
    c.fillStyle = col;

    // Hull
    c.beginPath();
    c.moveTo(x-85, y);
    c.quadraticCurveTo(x-90, y+18, x-60, y+26);
    c.lineTo(x+60, y+26);
    c.quadraticCurveTo(x+95, y+22, x+92, y+4);
    c.lineTo(x+88, y-6);
    c.closePath(); c.fill();

    // Grass deck dome (slight green)
    c.fillStyle = 'rgba(18,55,12,0.60)';
    c.beginPath(); c.ellipse(x, y-20, 42, 20, 0, 0, Math.PI); c.fill();

    // Main mast
    c.fillStyle = col;
    c.fillRect(x-5, y-108, 9, 90);

    // Crow's nest
    c.beginPath(); c.arc(x, y-112, 12, 0, Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(x, y-102, 15, 5, 0, 0, Math.PI*2); c.fill();

    // Sails (both sides)
    c.beginPath();
    c.moveTo(x-5, y-105);
    c.lineTo(x-62, y-62); c.lineTo(x-58, y-28); c.lineTo(x-5, y-38);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(x+5, y-105);
    c.lineTo(x+62, y-62); c.lineTo(x+58, y-28); c.lineTo(x+5, y-38);
    c.closePath(); c.fill();

    // Figurehead (lion head)
    c.beginPath(); c.arc(x+92, y-2, 18, 0, Math.PI*2); c.fill();
    // Mane
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.5 - 0.2;
      c.beginPath();
      c.moveTo(x+92, y-2);
      c.lineTo(x+92+Math.cos(a)*30, y-2+Math.sin(a)*30);
      c.lineWidth = 5; c.strokeStyle = col; c.stroke();
    }
    // Jolly Roger flag
    c.fillStyle = 'rgba(12,5,38,0.85)';
    c.fillRect(x+5, y-108, 22, 15);

    c.restore();
  }

  // ─── Obstacles ──────────────────────────────────────────────────

  private drawObstacles() {
    for (const o of this.obstacles) {
      const c = this.cx; c.save();

      // Ground shadow (ground-based obstacles only)
      if (o.type !== 'bird') {
        c.globalAlpha = 0.45;
        c.fillStyle = '#000';
        c.beginPath();
        c.ellipse(o.x+o.w/2, this.GY+6, o.w*0.52, 7, 0, 0, Math.PI*2);
        c.fill();
        c.globalAlpha = 1;
      }

      if (o.type === 'rock') {
        // Boulder - irregular shape, high contrast
        c.strokeStyle = '#1A1A1A'; c.lineWidth = 3.5;

        // Rock body (irregular path)
        const cx2 = o.x + o.w/2, cy = o.y + o.h*0.55;
        const rw = o.w*0.52, rh = o.h*0.50;
        const rockG = c.createRadialGradient(cx2-rw*0.25, cy-rh*0.3, 2, cx2, cy, Math.max(rw,rh)*1.1);
        rockG.addColorStop(0, '#B0BEC5');
        rockG.addColorStop(0.5, '#78909C');
        rockG.addColorStop(1, '#37474F');
        c.fillStyle = rockG;
        c.beginPath();
        c.moveTo(o.x+o.w*0.08, o.y+o.h);
        c.bezierCurveTo(o.x-6,      o.y+o.h*0.55, o.x+o.w*0.02, o.y+o.h*0.10, o.x+o.w*0.32, o.y+4);
        c.bezierCurveTo(o.x+o.w*0.5, o.y-5,        o.x+o.w*0.80, o.y+o.h*0.08, o.x+o.w+5, o.y+o.h*0.48);
        c.bezierCurveTo(o.x+o.w+6,  o.y+o.h*0.78,  o.x+o.w*0.92, o.y+o.h, o.x+o.w*0.08, o.y+o.h);
        c.closePath(); c.fill(); c.stroke();

        // Top highlight
        c.fillStyle = 'rgba(255,255,255,0.22)';
        c.beginPath();
        c.ellipse(o.x+o.w*0.3, o.y+o.h*0.28, o.w*0.2, o.h*0.16, -0.4, 0, Math.PI*2);
        c.fill();

        // Cracks
        c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(o.x+o.w*0.45, o.y+o.h*0.22);
        c.lineTo(o.x+o.w*0.36, o.y+o.h*0.48);
        c.lineTo(o.x+o.w*0.44, o.y+o.h*0.65);
        c.stroke();
        c.beginPath();
        c.moveTo(o.x+o.w*0.63, o.y+o.h*0.30);
        c.lineTo(o.x+o.w*0.72, o.y+o.h*0.55);
        c.stroke();

      } else if (o.type === 'spike') {
        const baseH = 24;

        // Wooden base - large and clear
        const baseG = c.createLinearGradient(o.x, o.y+o.h-baseH, o.x+o.w, o.y+o.h);
        baseG.addColorStop(0, '#A1887F'); baseG.addColorStop(1, '#6D4C41');
        c.fillStyle = baseG; c.strokeStyle = '#1A1A1A'; c.lineWidth = 3;
        c.beginPath(); (c as any).roundRect(o.x-3, o.y+o.h-baseH, o.w+6, baseH+4, 4); c.fill(); c.stroke();

        // Wood grain lines
        c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 1;
        const segments = Math.ceil(o.w / 18);
        for (let wi = 1; wi < segments; wi++) {
          const lx = o.x + wi*(o.w/segments);
          c.beginPath(); c.moveTo(lx, o.y+o.h-baseH+3); c.lineTo(lx, o.y+o.h); c.stroke();
        }

        // Spikes - tall and menacing
        const ns = Math.max(2, Math.floor(o.w/18));
        for (let i = 0; i < ns; i++) {
          const sx = o.x + (i+0.5)*(o.w/ns);
          const sH = o.h - baseH;

          // Metallic spike body
          const spikeG = c.createLinearGradient(sx-10, 0, sx+10, 0);
          spikeG.addColorStop(0, '#B0BEC5');
          spikeG.addColorStop(0.4, '#ECEFF1');
          spikeG.addColorStop(1, '#78909C');
          c.fillStyle = spikeG; c.strokeStyle = '#1A1A1A'; c.lineWidth = 2.5;
          c.beginPath();
          c.moveTo(sx-10, o.y+o.h-baseH-1);
          c.lineTo(sx,    o.y+3);
          c.lineTo(sx+10, o.y+o.h-baseH-1);
          c.closePath(); c.fill(); c.stroke();

          // Red blood/warning tip
          c.fillStyle = '#D32F2F';
          c.beginPath(); c.arc(sx, o.y+6, 5, 0, Math.PI*2); c.fill();
          c.fillStyle = '#FF5252';
          c.beginPath(); c.arc(sx-1, o.y+5, 2, 0, Math.PI*2); c.fill();

          // Warning stripes on lower spike
          c.fillStyle = '#FF8F00'; c.globalAlpha = 0.6;
          c.fillRect(sx-9, o.y+sH*0.65, 18, 5);
          c.fillStyle = '#212121';
          c.fillRect(sx-9, o.y+sH*0.65+5, 18, 2.5);
          c.globalAlpha = 1;
        }

        // Sanji immunity glow
        if (this.selectedChar === 'sanji' && this.state === 'playing') {
          c.globalAlpha = 0.18; c.fillStyle = '#FF6D00';
          c.fillRect(o.x-3, o.y, o.w+6, o.h); c.globalAlpha = 1;
        }

      } else {
        // Bird - large, dramatic silhouette
        const bx = o.x + o.w/2, by = o.y + o.h/2;
        const flap = Math.sin(this.bgOff * 0.28) * 18;

        c.fillStyle = '#0D1040';

        // Wings
        c.beginPath();
        c.moveTo(bx-16, by);
        c.quadraticCurveTo(o.x+12, by-flap-8, o.x-14, by-flap+4);
        c.quadraticCurveTo(o.x+6, by+10, bx-16, by+5);
        c.closePath(); c.fill();
        c.beginPath();
        c.moveTo(bx+16, by);
        c.quadraticCurveTo(o.x+o.w-12, by-flap-8, o.x+o.w+14, by-flap+4);
        c.quadraticCurveTo(o.x+o.w-6, by+10, bx+16, by+5);
        c.closePath(); c.fill();

        // Body
        c.beginPath(); c.ellipse(bx, by, o.w*0.22, o.h*0.30, 0, 0, Math.PI*2); c.fill();

        // Head
        c.beginPath(); c.arc(bx+o.w*0.2, by-8, 11, 0, Math.PI*2); c.fill();

        // Beak (yellow, visible)
        c.fillStyle = '#FFD600'; c.strokeStyle = '#F57F17'; c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(bx+o.w*0.2+10, by-10);
        c.lineTo(bx+o.w*0.2+26, by-8);
        c.lineTo(bx+o.w*0.2+10, by-5);
        c.closePath(); c.fill(); c.stroke();

        // Red glowing eye
        c.fillStyle = '#F44336';
        c.beginPath(); c.arc(bx+o.w*0.2+5, by-10, 4, 0, Math.PI*2); c.fill();
        c.fillStyle = '#FFCDD2';
        c.beginPath(); c.arc(bx+o.w*0.2+4, by-11, 1.8, 0, Math.PI*2); c.fill();

        // Wing feather detail tips
        c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(o.x-8, by-flap+8); c.lineTo(o.x-14, by-flap+5); c.stroke();
        c.beginPath(); c.moveTo(o.x+o.w+8, by-flap+8); c.lineTo(o.x+o.w+14, by-flap+5); c.stroke();
      }
      c.restore();
    }
  }

  // ─── Characters ─────────────────────────────────────────────────

  private drawChar(x: number, y: number, t: number, jumping: boolean, jumps: number) {
    if (this.selectedChar === 'luffy') this.drawLuffy(x, y, t, jumping, jumps);
    else if (this.selectedChar === 'zoro') this.drawZoro(x, y, t, jumping);
    else this.drawSanji(x, y, t, jumping);
  }

  private shadow(x: number, y: number, w = 22) {
    this.cx.fillStyle = 'rgba(0,0,0,0.25)';
    this.cx.beginPath(); this.cx.ellipse(x, y+5, w, 6, 0, 0, Math.PI*2); this.cx.fill();
  }

  private drawLuffy(x: number, y: number, t: number, jumping: boolean, jumps: number) {
    const c = this.cx; c.save();
    this.shadow(x, y);
    const lp = jumping ? 0 : Math.sin(t)*14;

    // Legs (blue shorts)
    c.lineCap = 'round';
    c.strokeStyle = '#0D47A1'; c.lineWidth = 14;
    c.beginPath(); c.moveTo(x-7,y-30); c.lineTo(x-8+lp,y-1); c.stroke();
    c.strokeStyle = '#1976D2'; c.lineWidth = 11;
    c.beginPath(); c.moveTo(x-7,y-30); c.lineTo(x-8+lp,y-1); c.stroke();
    c.strokeStyle = '#0D47A1'; c.lineWidth = 14;
    c.beginPath(); c.moveTo(x+7,y-30); c.lineTo(x+8-lp,y-1); c.stroke();
    c.strokeStyle = '#1976D2'; c.lineWidth = 11;
    c.beginPath(); c.moveTo(x+7,y-30); c.lineTo(x+8-lp,y-1); c.stroke();

    // Shoes
    c.fillStyle='#111'; c.strokeStyle='#000'; c.lineWidth=1.5;
    c.beginPath(); c.ellipse(x-8+lp,y,12,5.5,0.18,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x+8-lp,y,12,5.5,-0.18,0,Math.PI*2); c.fill(); c.stroke();

    // Torso (red vest open)
    c.fillStyle='#CC1111'; c.strokeStyle='#800000'; c.lineWidth=3;
    c.beginPath(); (c as any).roundRect(x-19,y-74,38,45,7); c.fill(); c.stroke();
    c.fillStyle='#FFCC99'; // bare chest
    c.beginPath(); c.moveTo(x-1,y-74); c.lineTo(x-12,y-50); c.lineTo(x-1,y-33); c.lineTo(x+12,y-50); c.closePath(); c.fill();

    // Arms
    const ap = jumping ? -22 : Math.sin(t+Math.PI)*16, ap2 = jumping ? 22 : Math.sin(t)*16;
    c.strokeStyle='#FFCC99'; c.lineWidth=11; c.lineCap='round';
    c.beginPath(); c.moveTo(x-18,y-65); c.lineTo(x-28+ap,y-44); c.stroke();
    c.beginPath(); c.moveTo(x+18,y-65); c.lineTo(x+28+ap2,y-44); c.stroke();
    c.fillStyle='#FFCC99'; c.strokeStyle='#CC8844'; c.lineWidth=2;
    c.beginPath(); c.arc(x-28+ap,y-44,7,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); c.arc(x+28+ap2,y-44,7,0,Math.PI*2); c.fill(); c.stroke();

    // Head
    c.fillStyle='#FFCC99'; c.strokeStyle='#AA7733'; c.lineWidth=3;
    c.beginPath(); c.arc(x,y-95,24,0,Math.PI*2); c.fill(); c.stroke();

    // Black hair under hat
    c.fillStyle='#111';
    for (let i=-2;i<=2;i++) { c.beginPath(); c.arc(x+i*7.5,y-116,7.5,0,Math.PI*2); c.fill(); }

    // Straw hat (wide brim)
    c.fillStyle='#E8C94E'; c.strokeStyle='#7A5800'; c.lineWidth=3;
    c.beginPath(); c.ellipse(x,y-110,33,8.5,0,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x,y-117,20,14,0,0,Math.PI*2); c.fill(); c.stroke();
    c.fillStyle='#CC1111';
    c.beginPath(); c.ellipse(x,y-111,32,6.5,0,0,Math.PI*2); c.fill();
    c.fillStyle='#E8C94E';
    c.beginPath(); c.ellipse(x,y-111,22,5.5,0,0,Math.PI*2); c.fill();

    // Eyes
    c.fillStyle='#fff';
    c.beginPath(); c.ellipse(x-8,y-96,5.5,5,0,0,Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(x+8,y-96,5.5,5,0,0,Math.PI*2); c.fill();
    c.fillStyle='#111';
    c.beginPath(); c.arc(x-8,y-96,3.2,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(x+8,y-96,3.2,0,Math.PI*2); c.fill();
    // Eye shine
    c.fillStyle='#fff';
    c.beginPath(); c.arc(x-6.5,y-97.5,1.2,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(x+9.5,y-97.5,1.2,0,Math.PI*2); c.fill();

    // Scar
    c.strokeStyle='#8B4513'; c.lineWidth=2;
    c.beginPath(); c.moveTo(x-14,y-90); c.lineTo(x-9,y-85); c.stroke();
    c.beginPath(); c.moveTo(x-9,y-90); c.lineTo(x-14,y-85); c.stroke();

    // Big smile
    c.strokeStyle='#111'; c.lineWidth=2.5;
    c.beginPath(); c.arc(x,y-84,12,0.12,Math.PI-0.12); c.stroke();

    // Gear 2 steam (double jump)
    if (jumping && jumps >= 2) {
      c.save(); c.globalAlpha=0.55;
      for (let i=0; i<8; i++) {
        c.fillStyle = ['#FF5252','#FF6E40','#FFAB40','#FF3D00'][i%4];
        c.beginPath();
        c.arc(x-24+i*7+Math.sin(t*5+i)*5, y+Math.random()*14, 5+Math.random()*7, 0, Math.PI*2);
        c.fill();
      }
      c.restore();
    }
    c.restore();
  }

  private drawZoro(x: number, y: number, t: number, jumping: boolean) {
    const c = this.cx; c.save();
    this.shadow(x, y);
    const lp = jumping ? 0 : Math.sin(t*1.4)*14;

    // Boots
    c.fillStyle='#4E342E'; c.strokeStyle='#212121'; c.lineWidth=2.5;
    c.beginPath(); (c as any).roundRect(x-20,y-14,16,15,4); c.fill(); c.stroke();
    c.beginPath(); (c as any).roundRect(x+4, y-14,16,15,4); c.fill(); c.stroke();

    // Pants
    c.strokeStyle='#212121'; c.lineWidth=15; c.lineCap='round';
    c.beginPath(); c.moveTo(x-7,y-36); c.lineTo(x-8+lp,y-12); c.stroke();
    c.strokeStyle='#1A1A2E'; c.lineWidth=12;
    c.beginPath(); c.moveTo(x-7,y-36); c.lineTo(x-8+lp,y-12); c.stroke();
    c.strokeStyle='#212121'; c.lineWidth=15;
    c.beginPath(); c.moveTo(x+7,y-36); c.lineTo(x+8-lp,y-12); c.stroke();
    c.strokeStyle='#1A1A2E'; c.lineWidth=12;
    c.beginPath(); c.moveTo(x+7,y-36); c.lineTo(x+8-lp,y-12); c.stroke();

    // Green sash
    c.fillStyle='#1B5E20'; c.strokeStyle='#212121'; c.lineWidth=2.5;
    c.beginPath(); (c as any).roundRect(x-22,y-45,44,11,3); c.fill(); c.stroke();
    c.fillStyle='#2E7D32';
    c.beginPath(); (c as any).roundRect(x-22,y-45,44,5,3); c.fill();

    // White open shirt
    c.fillStyle='#ECEFF1'; c.strokeStyle='#212121'; c.lineWidth=3;
    c.beginPath(); (c as any).roundRect(x-19,y-80,38,38,7); c.fill(); c.stroke();
    c.fillStyle='#FFCC99';
    c.beginPath(); c.moveTo(x,y-80); c.lineTo(x-11,y-62); c.lineTo(x,y-53); c.lineTo(x+11,y-62); c.closePath(); c.fill();

    // Arms
    const ap=jumping?-25:Math.sin(t+Math.PI)*20, ap2=jumping?25:Math.sin(t)*20;
    c.strokeStyle='#FFCC99'; c.lineWidth=13; c.lineCap='round';
    c.beginPath(); c.moveTo(x-18,y-72); c.lineTo(x-31+ap,y-50); c.stroke();
    c.beginPath(); c.moveTo(x+18,y-72); c.lineTo(x+31+ap2,y-50); c.stroke();
    c.fillStyle='#FFCC99'; c.strokeStyle='#AA7733'; c.lineWidth=2;
    c.beginPath(); c.arc(x-31+ap,y-50,7.5,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); c.arc(x+31+ap2,y-50,7.5,0,Math.PI*2); c.fill(); c.stroke();

    // Three swords
    for (let i=0; i<3; i++) {
      const sy2 = y-46-i*11;
      c.fillStyle='#5D4037'; c.beginPath(); (c as any).roundRect(x+16,sy2-4,14,8,2); c.fill();
      c.fillStyle='#FFD700'; c.beginPath(); (c as any).roundRect(x+28,sy2-6,4,12,1); c.fill();
      c.strokeStyle='#1A1A1A'; c.lineWidth=1;
      c.beginPath(); c.arc(x+26,sy2,3,0,Math.PI*2); c.stroke();
    }

    // Head
    c.fillStyle='#FFCC99'; c.strokeStyle='#AA7733'; c.lineWidth=3;
    c.beginPath(); c.arc(x,y-102,24,0,Math.PI*2); c.fill(); c.stroke();

    // Green spiky hair
    c.fillStyle='#1B5E20'; c.strokeStyle='#212121'; c.lineWidth=2.5;
    c.beginPath(); c.ellipse(x,y-113,22,17,0,0,Math.PI*2); c.fill(); c.stroke();
    const spikes=[[-18,-7],[-12,-18],[-4,-23],[4,-23],[12,-18],[18,-7]];
    for (const [dx,dy] of spikes) {
      c.beginPath(); c.ellipse(x+dx,y-113+dy,9.5,13,0,0,Math.PI*2); c.fill(); c.stroke();
    }

    // White headband
    c.fillStyle='#FFFFFF'; c.strokeStyle='#9E9E9E'; c.lineWidth=1.5;
    c.beginPath(); (c as any).roundRect(x-25,y-106,50,7,2); c.fill(); c.stroke();

    // Eyes (stern, determined)
    c.fillStyle='#fff';
    c.beginPath(); c.ellipse(x-8,y-102,5.5,3.8,0,0,Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(x+8,y-102,5.5,3.8,0,0,Math.PI*2); c.fill();
    c.fillStyle='#111';
    c.beginPath(); c.arc(x-8,y-102,2.8,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(x+8,y-102,2.8,0,Math.PI*2); c.fill();
    c.strokeStyle='#111'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(x-15,y-107); c.lineTo(x-4,y-104); c.stroke();
    c.beginPath(); c.moveTo(x+15,y-107); c.lineTo(x+4,y-104); c.stroke();
    c.lineWidth=2;
    c.beginPath(); c.moveTo(x-5,y-93); c.lineTo(x+5,y-93); c.stroke();

    // Speed lines (Zoro)
    if (!jumping && this.state==='playing') {
      c.save(); c.globalAlpha=0.38; c.strokeStyle='#fff'; c.lineWidth=2;
      for (let i=0; i<5; i++) {
        const ly = y-25-i*20;
        c.beginPath(); c.moveTo(x-50-i*8,ly); c.lineTo(x-92-i*8,ly); c.stroke();
      }
      c.restore();
    }
    c.restore();
  }

  private drawSanji(x: number, y: number, t: number, jumping: boolean) {
    const c = this.cx; c.save();
    this.shadow(x, y);
    const lp = jumping ? 0 : Math.sin(t)*13;

    const nearSpike = this.state==='playing' && this.obstacles.some(o =>
      o.type==='spike' && o.x < x+58 && o.x+o.w > x-40 && !jumping
    );

    // Dress shoes
    c.fillStyle='#111'; c.strokeStyle='#000'; c.lineWidth=1.5;
    c.beginPath(); c.ellipse(x-8+lp,y,12.5,5.5,0.15,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x+8-lp,y,12.5,5.5,-0.15,0,Math.PI*2); c.fill(); c.stroke();

    // Ifrit Jambe flames
    if (nearSpike) {
      c.save();
      for (let fi=0; fi<12; fi++) {
        c.fillStyle=['#FF6D00','#FF3D00','#FFAB00','#FF8C00'][fi%4];
        c.globalAlpha=0.65+Math.sin(t*4+fi)*0.3;
        const fx=x-24+fi*4.5+Math.sin(t*5+fi*1.3)*5;
        const fh=22+Math.sin(t*3+fi*1.7)*14;
        c.beginPath(); c.moveTo(fx,y-2); c.lineTo(fx-7,y-2-fh); c.lineTo(fx+7,y-2-fh); c.closePath(); c.fill();
      }
      c.restore();
    }

    // Suit trousers
    c.strokeStyle='#212121'; c.lineWidth=15; c.lineCap='round';
    c.beginPath(); c.moveTo(x-7,y-34); c.lineTo(x-8+lp,y-2); c.stroke();
    c.strokeStyle='#1A1A2E'; c.lineWidth=12;
    c.beginPath(); c.moveTo(x-7,y-34); c.lineTo(x-8+lp,y-2); c.stroke();
    c.strokeStyle='#212121'; c.lineWidth=15;
    c.beginPath(); c.moveTo(x+7,y-34); c.lineTo(x+8-lp,y-2); c.stroke();
    c.strokeStyle='#1A1A2E'; c.lineWidth=12;
    c.beginPath(); c.moveTo(x+7,y-34); c.lineTo(x+8-lp,y-2); c.stroke();

    // Jacket
    c.fillStyle='#1A1A2E'; c.strokeStyle='#212121'; c.lineWidth=3;
    c.beginPath(); (c as any).roundRect(x-20,y-77,40,46,7); c.fill(); c.stroke();
    // Lapels
    c.fillStyle='#EEE';
    c.beginPath(); c.moveTo(x,y-77); c.lineTo(x-10,y-59); c.lineTo(x,y-51); c.lineTo(x+10,y-59); c.closePath(); c.fill();
    // Tie
    c.fillStyle='#111';
    c.beginPath(); c.moveTo(x-4,y-59); c.lineTo(x+4,y-59); c.lineTo(x+3.5,y-34); c.lineTo(x,y-30); c.lineTo(x-3.5,y-34); c.closePath(); c.fill();
    // Button
    c.fillStyle='#888';
    c.beginPath(); c.arc(x,y-46,2,0,Math.PI*2); c.fill();

    // Arms
    const ap=jumping?-20:Math.sin(t+Math.PI)*15, ap2=jumping?20:Math.sin(t)*15;
    c.strokeStyle='#1A1A2E'; c.lineWidth=13; c.lineCap='round';
    c.beginPath(); c.moveTo(x-18,y-68); c.lineTo(x-29+ap,y-47); c.stroke();
    c.beginPath(); c.moveTo(x+18,y-68); c.lineTo(x+29+ap2,y-47); c.stroke();
    // White cuffs
    c.strokeStyle='#EEE'; c.lineWidth=3.5;
    c.beginPath(); c.arc(x-29+ap,y-47,8,0,Math.PI*2); c.stroke();
    c.beginPath(); c.arc(x+29+ap2,y-47,8,0,Math.PI*2); c.stroke();
    c.fillStyle='#FFCC99'; c.strokeStyle='#AA7733'; c.lineWidth=2;
    c.beginPath(); c.arc(x-29+ap,y-47,7,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); c.arc(x+29+ap2,y-47,7,0,Math.PI*2); c.fill(); c.stroke();

    // Head
    c.fillStyle='#FFCC99'; c.strokeStyle='#AA7733'; c.lineWidth=3;
    c.beginPath(); c.arc(x,y-97,24,0,Math.PI*2); c.fill(); c.stroke();

    // Blonde hair
    c.fillStyle='#FFD600'; c.strokeStyle='#F57F17'; c.lineWidth=3;
    c.beginPath(); c.ellipse(x+5,y-110,18,14,0.25,0,Math.PI*2); c.fill(); c.stroke();
    // Swoop covering left eye
    c.beginPath();
    c.moveTo(x-23,y-99);
    c.quadraticCurveTo(x-21,y-115, x-4,y-117);
    c.quadraticCurveTo(x+10,y-118, x+14,y-110);
    c.quadraticCurveTo(x+5,y-99,   x-5,y-99);
    c.quadraticCurveTo(x-16,y-91,  x-25,y-95);
    c.closePath(); c.fill(); c.stroke();

    // Right eye only
    c.fillStyle='#fff';
    c.beginPath(); c.ellipse(x+8,y-97,5.5,4.5,0,0,Math.PI*2); c.fill();
    c.fillStyle='#222';
    c.beginPath(); c.arc(x+8,y-97,3.2,0,Math.PI*2); c.fill();
    c.fillStyle='#fff';
    c.beginPath(); c.arc(x+9,y-98.5,1.3,0,Math.PI*2); c.fill();
    c.strokeStyle='#F57F17'; c.lineWidth=2.2;
    c.beginPath(); c.moveTo(x+2,y-103); c.quadraticCurveTo(x+8,y-106,x+15,y-103); c.stroke();

    // Cigarette
    c.fillStyle='#EEE'; c.strokeStyle='#BDBDBD'; c.lineWidth=1.2;
    c.beginPath(); (c as any).roundRect(x+8,y-90,18,4,1.5); c.fill(); c.stroke();
    // Ember glow
    c.fillStyle='#FF6D00'; c.globalAlpha=0.8;
    c.beginPath(); c.arc(x+26,y-88,3,0,Math.PI*2); c.fill(); c.globalAlpha=1;
    // Smoke
    c.fillStyle='#BDBDBD'; c.globalAlpha=0.4+Math.sin(t)*0.1;
    c.beginPath(); c.arc(x+28,y-93+Math.sin(t)*3,5,0,Math.PI*2); c.fill(); c.globalAlpha=1;

    c.strokeStyle='#333'; c.lineWidth=2;
    c.beginPath(); c.arc(x+5,y-87,5.5,0.1,Math.PI*0.65); c.stroke();
    c.restore();
  }

  private drawParticles() {
    const c = this.cx; c.save();
    for (const p of this.particles) {
      c.globalAlpha = p.life; c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x,p.y,p.size*p.life,0,Math.PI*2); c.fill();
    }
    c.restore();
  }

  // ─── HUD ────────────────────────────────────────────────────────

  private drawHUD() {
    const c = this.cx; c.save();

    // Score - Wanted Poster style
    c.fillStyle='#FFF8E1'; c.strokeStyle='#3E2723'; c.lineWidth=2.5;
    c.beginPath(); (c as any).roundRect(this.W-172,8,164,82,5); c.fill(); c.stroke();
    // Red banner header
    c.fillStyle='#C62828';
    c.beginPath(); (c as any).roundRect(this.W-172,8,164,26,[5,5,0,0]); c.fill();
    c.fillStyle='#FFF8E1'; c.font='bold 13px Georgia'; c.textAlign='center';
    c.fillText('★  SCORE  ★', this.W-90, 25);
    // Score number
    c.fillStyle='#1A0A00'; c.font='bold 30px Georgia';
    c.fillText(String(this.score), this.W-90, 60);
    // Hi score
    c.fillStyle='#795548'; c.font='10px Georgia'; c.textAlign='right';
    c.fillText(`RECORD: ${this.hiScore}`, this.W-14, 80);

    // Char panel
    const ch = this.chars[this.selectedChar];
    c.fillStyle='#FFF8E1'; c.strokeStyle=ch.color; c.lineWidth=2.5;
    c.beginPath(); (c as any).roundRect(8,8,200,60,5); c.fill(); c.stroke();
    c.textAlign='left';
    c.fillStyle=ch.color; c.font='bold 14px Georgia';
    c.fillText(ch.name, 16, 28);
    c.fillStyle='#333'; c.font='bold 11px Georgia';
    c.fillText(`★ ${ch.ability}`, 16, 44);
    c.fillStyle='#666'; c.font='10px Georgia';
    c.fillText(ch.desc, 16, 58);

    // Speed bar
    const spd = Math.min(1, (this.speed-5)/20);
    c.fillStyle='rgba(0,0,0,0.6)'; c.strokeStyle='rgba(255,255,255,0.2)'; c.lineWidth=1;
    c.beginPath(); (c as any).roundRect(8,74,200,20,4); c.fill(); c.stroke();
    const sc = spd<0.4?'#43A047':spd<0.72?'#FF8F00':'#D32F2F';
    c.fillStyle=sc;
    c.beginPath(); (c as any).roundRect(10,76,196*spd,16,3); c.fill();
    c.fillStyle='#fff'; c.font='bold 9px monospace'; c.textAlign='left';
    c.fillText(`VITESSE: ${this.speed.toFixed(1)}`, 14,87);

    // Milestone
    if (this.milestoneFade > 0) {
      c.save();
      c.globalAlpha = Math.min(1, this.milestoneFade*1.6);
      c.font='bold 30px Georgia'; c.textAlign='center';
      c.shadowColor='#FF6600'; c.shadowBlur=25;
      c.fillStyle='#FFD700';
      c.fillText(this.milestoneMsg, this.W/2, 48);
      c.restore();
    }

    c.restore();
  }

  // ─── Screens ────────────────────────────────────────────────────

  private drawTitle() {
    const c = this.cx; c.save();
    c.fillStyle='rgba(4,2,22,0.87)'; c.fillRect(0,0,this.W,this.H);

    // Gold border
    c.strokeStyle='#FFD700'; c.lineWidth=4.5;
    c.beginPath(); (c as any).roundRect(14,14,this.W-28,this.H-28,8); c.stroke();
    c.strokeStyle='rgba(255,215,0,0.20)'; c.lineWidth=2;
    c.beginPath(); (c as any).roundRect(23,23,this.W-46,this.H-46,6); c.stroke();

    this.drawSkull(this.W/2, 80, 42, this.animT);

    // Title
    c.shadowColor='#FF3300'; c.shadowBlur=35;
    c.fillStyle='#FFD700'; c.font='bold 72px Georgia'; c.textAlign='center';
    c.fillText('ONE PIECE', this.W/2, 168);
    c.shadowBlur=0;
    c.fillStyle='#EF5350'; c.font='bold 38px Georgia';
    c.fillText('RUNNER', this.W/2, 215);
    c.strokeStyle='rgba(255,215,0,0.5)'; c.lineWidth=2;
    c.beginPath(); c.moveTo(this.W/2-200,228); c.lineTo(this.W/2+200,228); c.stroke();

    // Characters preview
    const py = this.H - 82;
    this.drawLuffy(this.W/2-215, py, this.animT*3.5, false, 0);
    c.fillStyle='#EE3333'; c.font='bold 13px Georgia'; c.textAlign='center';
    c.fillText('LUFFY', this.W/2-215, py+20);

    this.drawZoro(this.W/2, py, this.animT*4, false);
    c.fillStyle='#22BB44'; c.font='bold 13px Georgia';
    c.fillText('ZORO', this.W/2, py+20);

    this.drawSanji(this.W/2+215, py, this.animT*3.8, false);
    c.fillStyle='#4488EE'; c.font='bold 13px Georgia';
    c.fillText('SANJI', this.W/2+215, py+20);

    // Blink prompt
    c.globalAlpha=0.5+0.5*Math.sin(this.animT*3.5);
    c.fillStyle='#FFD700'; c.font='bold 20px Georgia'; c.textAlign='center';
    c.fillText('[ ESPACE  /  CLIC  pour commencer ]', this.W/2, this.H-10);
    c.globalAlpha=1; c.restore();
  }

  private drawSkull(x: number, y: number, r: number, t: number) {
    const c = this.cx; c.save();
    c.fillStyle='#FFD700'; c.strokeStyle='#8B6914'; c.lineWidth=2.5;
    c.beginPath(); c.arc(x,y-9,r*0.66,0,Math.PI*2); c.fill(); c.stroke();
    c.beginPath(); (c as any).roundRect(x-r*0.43,y+9,r*0.86,r*0.42,6); c.fill(); c.stroke();
    c.fillStyle='rgba(4,2,22,0.9)';
    c.beginPath(); c.arc(x-r*0.24,y-11,r*0.16,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(x+r*0.24,y-11,r*0.16,0,Math.PI*2); c.fill();
    // Nostrils (classic skull)
    c.beginPath(); c.moveTo(x-4,y+5); c.lineTo(x-6,y+11); c.lineTo(x-1,y+10); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x+4,y+5); c.lineTo(x+6,y+11); c.lineTo(x+1,y+10); c.closePath(); c.fill();
    // Crossbones
    c.strokeStyle='#FFD700'; c.lineWidth=9; c.lineCap='round';
    const rot=Math.sin(t*0.6)*0.14;
    c.save(); c.translate(x,y+30); c.rotate(rot); c.beginPath(); c.moveTo(-r,0); c.lineTo(r,0); c.stroke(); c.restore();
    c.save(); c.translate(x,y+30); c.rotate(-rot+Math.PI/2); c.beginPath(); c.moveTo(-r,0); c.lineTo(r,0); c.stroke(); c.restore();
    c.restore();
  }

  private drawSelect() {
    const c = this.cx; c.save();
    c.fillStyle='rgba(4,2,22,0.92)'; c.fillRect(0,0,this.W,this.H);
    c.fillStyle='#FFD700'; c.font='bold 38px Georgia'; c.textAlign='center';
    c.fillText('CHOISIS TON ÉQUIPIER', this.W/2, 54);
    c.strokeStyle='rgba(255,215,0,0.4)'; c.lineWidth=2;
    c.beginPath(); c.moveTo(this.W/2-225,66); c.lineTo(this.W/2+225,66); c.stroke();

    const ids: CharId[] = ['luffy','zoro','sanji'];
    const cw=220, ch=305;
    const sx = this.W/2 - (cw*3+40)/2;

    ids.forEach((id,i) => {
      const ch2 = this.chars[id];
      const cardX = sx+i*(cw+20), cardY=72;
      const cardCX = cardX+cw/2;
      const sel = id===this.selectedChar;
      const bounce = sel ? Math.sin(this.animT*2.8)*7 : 0;

      // Card
      c.fillStyle = sel ? `${ch2.color}1A` : 'rgba(0,0,0,0.7)';
      c.strokeStyle = sel ? ch2.color : '#444';
      c.lineWidth = sel ? 4 : 1.5;
      if (sel) { c.shadowColor=ch2.color; c.shadowBlur=25; }
      c.beginPath(); (c as any).roundRect(cardX,cardY,cw,ch,12); c.fill(); c.stroke();
      c.shadowBlur=0;

      // Character inside card
      const charY = cardY+152+bounce;
      if (id==='luffy') this.drawLuffy(cardCX,charY,this.animT*4.5,false,0);
      else if (id==='zoro') this.drawZoro(cardCX,charY,this.animT*5,false);
      else this.drawSanji(cardCX,charY,this.animT*4.8,false);

      // Text info
      c.fillStyle=sel?ch2.color:'#CCC'; c.font=`bold ${sel?17:15}px Georgia`; c.textAlign='center';
      c.fillText(ch2.name, cardCX, cardY+ch-88);
      c.fillStyle='#FFD700'; c.font='bold 13px Georgia';
      c.fillText(`★ ${ch2.ability}`, cardCX, cardY+ch-66);
      c.fillStyle='#AAA'; c.font='12px Georgia';
      c.fillText(ch2.desc, cardCX, cardY+ch-48);

      const stats: Record<CharId,string> = {
        luffy:'SAUT ↑↑  DOUBLE SAUT',
        zoro:'VITESSE ↑↑  SCORE ×2',
        sanji:'PICS: IMMUNISÉ',
      };
      c.fillStyle='rgba(255,215,0,0.55)'; c.font='10px monospace';
      c.fillText(stats[id], cardCX, cardY+ch-30);

      if (sel) {
        c.fillStyle=ch2.color; c.font='bold 14px Georgia';
        c.fillText('▲  SÉLECTIONNÉ  ▲', cardCX, cardY+ch-9);
      }
    });

    c.globalAlpha=0.5+0.5*Math.sin(this.animT*3.2);
    c.fillStyle='#FFD700'; c.font='bold 16px Georgia'; c.textAlign='center';
    c.fillText('← →  changer   |   ESPACE / CLIC  pour jouer', this.W/2, this.H-6);
    c.globalAlpha=1; c.restore();
  }

  private drawGameOver() {
    const c = this.cx; c.save();
    c.fillStyle='rgba(4,2,22,0.82)'; c.fillRect(0,0,this.W,this.H);

    const pw=440, ph=200;
    const px=this.W/2-pw/2, py=this.H/2-ph/2-30;

    // Wanted poster style
    c.fillStyle='#FFF8E1'; c.strokeStyle='#3E2723'; c.lineWidth=3.5;
    c.beginPath(); (c as any).roundRect(px,py,pw,ph,6); c.fill(); c.stroke();
    // Red banner
    c.fillStyle='#C62828';
    c.beginPath(); (c as any).roundRect(px,py,pw,34,[6,6,0,0]); c.fill();
    c.fillStyle='#FFF8E1'; c.font='bold 22px Georgia'; c.textAlign='center';
    c.fillText('★  GAME  OVER  ★', this.W/2, py+23);

    c.strokeStyle='#BCAAA4'; c.lineWidth=1;
    c.beginPath(); c.moveTo(px+16,py+46); c.lineTo(px+pw-16,py+46); c.stroke();

    c.fillStyle='#1A0A00'; c.font='bold 26px Georgia'; c.textAlign='center';
    c.fillText(`Score final: ${this.score}`, this.W/2, py+80);

    const isNew = this.score>0 && this.score>=this.hiScore;
    c.fillStyle=isNew?'#2E7D32':'#795548';
    c.font=isNew?'bold 17px Georgia':'14px Georgia';
    c.fillText(isNew?'✦ NOUVEAU RECORD ✦':`Record: ${this.hiScore}`, this.W/2, py+106);

    const quotes:Record<CharId,string> = {
      luffy:'"Je deviendrai le Roi des Pirates !"',
      zoro:'"Je ne perdrai plus jamais !"',
      sanji:'"Pour Nami-san et Robin-chan !"',
    };
    c.fillStyle='#5D4037'; c.font='italic 13px Georgia';
    c.fillText(quotes[this.selectedChar], this.W/2, py+130);

    c.globalAlpha=0.5+0.5*Math.sin(this.deathT*2.8);
    c.fillStyle='#3E2723'; c.font='13px Georgia';
    c.fillText('ESPACE: Rejouer   |   ÉCHAP: Changer de perso', this.W/2, py+162);
    c.globalAlpha=1;
    c.restore();
  }

  // Expose score for template
  get currentScore() { return this.score; }
  get shareVisible()  { return this.state === 'gameover'; }
}
