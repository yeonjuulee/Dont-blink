// =====================================================
// render.js — 캔버스 그리기 (디자인은 7단계에서 교체)
// =====================================================
import { CONFIG } from "./config.js";

const TAU = Math.PI * 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.t = 0;
  }

  draw(game, face, mic, dt) {
    const ctx = this.ctx;
    this.t += dt;

    this.drawFloor(ctx);

    const active = game.phase === "playing" || game.phase === "caught" || game.phase === "result";
    if (!active) return;

    this.updateParticles(game, mic, dt);
    this.drawParticles(ctx);
    this.drawMonster(ctx, game);
    this.drawPlayer(ctx, game, face);

    if (game.phase === "playing" && !game.paused) this.drawGazeArrow(ctx, game, face);

    if (game.phase === "playing" && game.chaser === "monster" && mic.isVoice) {
      const m = game.monster;
      this.drawBubble(ctx, m.x, m.y - m.r - 40, "🔊 그건 말이잖아!");
    }

    this.drawBanner(ctx, game);
  }

  // ---------- 바닥 ----------
  drawFloor(ctx) {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    ctx.fillStyle = "#14141c";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#1e1e2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < W; x += 40) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
    }
    for (let y = 40; y < H; y += 40) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();
  }

  // ---------- 입김 효과 ----------
  updateParticles(game, mic, dt) {
    const p = game.player;
    const m = game.monster;
    if (game.phase === "playing" && !game.paused && game.chaser === "monster" && mic.isBlowing) {
      const a = Math.atan2(m.y - p.y, m.x - p.x);
      for (let i = 0; i < 3; i++) {
        const spread = (Math.random() - 0.5) * 0.5;
        const sp = 260 + Math.random() * 120;
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(a + spread) * sp,
          vy: Math.sin(a + spread) * sp,
          life: 0.6,
          max: 0.6,
        });
      }
    }
    for (const q of this.particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  drawParticles(ctx) {
    ctx.lineWidth = 2;
    for (const q of this.particles) {
      const a = q.life / q.max;
      ctx.strokeStyle = `rgba(170, 220, 255, ${a * 0.8})`;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04);
      ctx.stroke();
    }
  }

  // ---------- 공통 ----------
  flicker(game) {
    return game.phase === "playing" && game.grace > 0 && Math.floor(this.t * 12) % 2 === 0;
  }

  drawChaserMark(ctx, x, y, r) {
    ctx.save();
    ctx.strokeStyle = "#ff4d4d";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -this.t * 30;
    ctx.beginPath();
    ctx.arc(x, y, r + 9, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#ff4d4d";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("술래", x, y - r - 14);
  }

  // ---------- 괴물 ----------
  drawMonster(ctx, game) {
    const m = game.monster;
    const p = game.player;
    const d = game.chaser === "monster" ? game.dryness : 0;
    const stage = d >= 80 ? 3 : d >= 50 ? 2 : 1;

    // 80% 이상이면 떨림
    const shake = stage === 3 ? 1.5 : 0;
    const x = m.x + (Math.random() - 0.5) * shake * 2;
    const y = m.y + (Math.random() - 0.5) * shake * 2;

    ctx.save();
    if (this.flicker(game)) ctx.globalAlpha = 0.45;

    // 몸
    ctx.fillStyle = "#3b2a4a";
    ctx.beginPath();
    ctx.arc(x, y, m.r, 0, TAU);
    ctx.fill();

    const eyeR = m.r * 0.72;

    if (m.blinkAnim > 0) {
      // 감은 눈
      ctx.strokeStyle = "#f5f5f5";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - eyeR, y);
      ctx.quadraticCurveTo(x, y + eyeR * 0.5, x + eyeR, y);
      ctx.stroke();
    } else {
      // 흰자
      ctx.fillStyle = stage === 3 ? "#f3c4c4" : "#f5f5f5";
      ctx.beginPath();
      ctx.arc(x, y, eyeR, 0, TAU);
      ctx.fill();

      // 핏줄
      if (stage >= 2) {
        const n = stage === 2 ? 4 : 8;
        ctx.strokeStyle = "#d63031";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + 0.3;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * eyeR, y + Math.sin(a) * eyeR);
          ctx.lineTo(x + Math.cos(a + 0.18) * eyeR * 0.55, y + Math.sin(a + 0.18) * eyeR * 0.55);
          ctx.stroke();
        }
      }

      // 홍채 + 동공: 항상 플레이어 쪽을 봄
      const ang = Math.atan2(p.y - y, p.x - x);
      const ix = x + Math.cos(ang) * eyeR * 0.35;
      const iy = y + Math.sin(ang) * eyeR * 0.35;
      ctx.fillStyle = "#7a3cff";
      ctx.beginPath();
      ctx.arc(ix, iy, eyeR * 0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(ix, iy, eyeR * 0.25, 0, TAU);
      ctx.fill();

      // 촉촉할 때만 하이라이트
      if (stage === 1) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ix - eyeR * 0.15, iy - eyeR * 0.15, eyeR * 0.1, 0, TAU);
        ctx.fill();
      }

      // 눈물
      if (stage === 3) {
        const ty = y + eyeR * 0.8 + ((this.t * 25) % 14);
        ctx.fillStyle = "#6cc6ff";
        ctx.beginPath();
        ctx.arc(x + eyeR * 0.6, ty, 3, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    if (game.chaser === "monster") this.drawChaserMark(ctx, m.x, m.y, m.r);
  }

  // ---------- 플레이어 ----------
  drawPlayer(ctx, game, face) {
    const p = game.player;

    ctx.save();
    if (this.flicker(game)) ctx.globalAlpha = 0.45;

    ctx.fillStyle = "#7fd6c2";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();

    // 눈: 실제 내 눈 상태를 그대로 보여줌
    for (const side of [-1, 1]) {
      const cx = p.x + side * 6;
      const cy = p.y - 3;
      if (face.eyesClosed) {
        ctx.strokeStyle = "#0b0b10";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy);
        ctx.lineTo(cx + 3, cy);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#0b0b10";
        ctx.beginPath();
        ctx.arc(cx + face.moveX * 2, cy + face.moveY * 2, 2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.fillStyle = "#7fd6c2";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("나", p.x, p.y + p.r + 4);

    if (game.chaser === "player") this.drawChaserMark(ctx, p.x, p.y, p.r);
  }

  // ---------- 시선 방향 화살표 ----------
  drawGazeArrow(ctx, game, face) {
    const mag = Math.hypot(face.moveX, face.moveY);
    if (mag < 0.05) return;
    const p = game.player;
    const dx = face.moveX / mag;
    const dy = face.moveY / mag;
    const start = p.r + 6;
    const len = start + 20 + 40 * mag;
    const sx = p.x + dx * start;
    const sy = p.y + dy * start;
    const ex = p.x + dx * len;
    const ey = p.y + dy * len;

    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a) * 8, ey + Math.sin(a) * 8);
    ctx.lineTo(ex + Math.cos(a + 2.5) * 8, ey + Math.sin(a + 2.5) * 8);
    ctx.lineTo(ex + Math.cos(a - 2.5) * 8, ey + Math.sin(a - 2.5) * 8);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 말풍선 ----------
  drawBubble(ctx, x, y, text) {
    ctx.font = "bold 15px sans-serif";
    const w = ctx.measureText(text).width + 20;
    const h = 28;
    const bx = Math.max(4, Math.min(CONFIG.WIDTH - w - 4, x - w / 2));
    const by = Math.max(4, y - h / 2);

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 8);
    else ctx.rect(bx, by, w, h);
    ctx.fill();

    ctx.fillStyle = "#14141c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + w / 2, by + h / 2);
  }

  // ---------- 가운데 알림 ----------
  drawBanner(ctx, game) {
    if (!game.banner) return;
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    const alpha = Math.min(1, game.banner.t * 2);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, H / 2 - 32, W, 64);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(game.banner.text, W / 2, H / 2);
    ctx.restore();
  }
}
