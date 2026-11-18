// =====================================================
// render.js — 게임 맵 그리기 (픽셀 스프라이트 + 공격 효과)
// HUD와 패널은 index.html / game.js(DOM)에서 처리
// =====================================================
import { CONFIG } from "./config.js";

const TAU = Math.PI * 2;

const SPRITES = {
  eye0: "assets/eye_0.svg", // 촉촉한 눈 (0~49%)
  eye1: "assets/eye_1.svg", // 핏줄 (50~79%)
  eye2: "assets/eye_2.svg", // 충혈 + 눈물 (80~99%)
  eye3: "assets/eye_3.svg", // 눈 감음
  eyeAttack: "assets/eye_attack.svg", // 공격 중
  playerOpen: "assets/player_open.svg",
  playerClosed: "assets/player_closed.svg",
};

const C = {
  green: "#4BFF6A",
  greenLight: "#B8FFC6",
  line: "rgba(75,255,106,0.07)",
  red: "#FF3B3B",
  blue: "#6CC6FF",
  bg: "#061006",
};

const DUST_COLORS = ["#8C9A6A", "#B8C49A", "#6E7A52", "#4BFF6A", "#A9B488"];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.t = 0;
    this.wind = [];
    this.dust = [];

    this.img = {};
    for (const [key, src] of Object.entries(SPRITES)) {
      const im = new Image();
      im.src = src;
      this.img[key] = im;
    }
  }

  ready(key) {
    const im = this.img[key];
    return im && im.complete && im.naturalWidth > 0;
  }

  sprite(key, cx, cy, w, h) {
    if (!this.ready(key)) return false;
    this.ctx.drawImage(this.img[key], Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
    return true;
  }

  // =====================================================
  draw(game, face, mic, dt) {
    const ctx = this.ctx;
    this.t += dt;
    ctx.imageSmoothingEnabled = false;

    ctx.save();

    // 깜짝 등장 공격 중이면 화면 흔들기
    const atk = game.attack;
    if (atk && atk.type === "scare" && atk.phase === "hit") {
      ctx.translate((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
    }

    this.drawFloor(ctx);

    const active = game.phase === "playing" || game.phase === "caught" || game.phase === "result";
    if (active) {
      if (atk && atk.type === "flash" && atk.phase === "warn") this.drawFlashRays(ctx, game, atk);

      this.updateWind(game, dt);
      this.drawWind(ctx);

      this.drawMonster(ctx, game);
      this.drawPlayer(ctx, game, face);

      if (game.phase === "playing" && !game.paused) this.drawGazeArrow(ctx, game, face);

      if (game.phase === "playing" && game.chaser === "monster" && mic.isVoice && !game.blowing) {
        const m = game.monster;
        this.drawBubble(ctx, m.x, m.y - m.r - 54, "그건 말이잖아!");
      }

      this.updateDust(game, dt);
      this.drawAttackHit(ctx, game);
      this.drawBanner(ctx, game);
    }

    ctx.restore();
  }

  // ---------- 바닥 ----------
  drawFloor(ctx) {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    ctx.fillStyle = C.bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = C.line;
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

  // ---------- 술래 표시: 빨간 점선 링 ----------
  drawChaserRing(ctx, x, y, r) {
    ctx.save();
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -this.t * 30;
    ctx.beginPath();
    ctx.arc(x, y, r + 12, 0, TAU);
    ctx.stroke();
    ctx.restore();

    this.glowText(ctx, "술래", x, y - r - 22, "20px 'Do Hyeon', sans-serif", C.red, "rgba(255,59,59,0.8)");
  }

  glowText(ctx, text, x, y, font, color, glow) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = glow;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  flicker(game) {
    return game.phase === "playing" && game.grace > 0 && Math.floor(this.t * 12) % 2 === 0;
  }

  // ---------- 괴물 ----------
  monsterSprite(game) {
    const m = game.monster;
    if (m.blinkAnim > 0) return "eye3";
    if (game.phase === "result" && game.winner === "player") return "eye3";
    if (game.attack && game.chaser === "player") return "eyeAttack";
    if (game.chaser !== "monster") return "eye0";
    const d = game.dryness;
    if (d >= 80) return "eye2";
    if (d >= 50) return "eye1";
    return "eye0";
  }

  drawMonster(ctx, game) {
    const m = game.monster;
    const key = this.monsterSprite(game);
    const size = m.r * 2.6;

    // 떨림: 눈이 거의 말랐을 때, 먼지 공격 예고 중
    let sx = 0;
    let sy = 0;
    const atk = game.attack;
    if (key === "eye2" || (atk && atk.type === "dust" && atk.phase === "warn")) {
      sx = (Math.random() - 0.5) * 4;
      sy = (Math.random() - 0.5) * 4;
    }

    ctx.save();
    if (this.flicker(game)) ctx.globalAlpha = 0.45;
    if (key === "eyeAttack") {
      ctx.shadowColor = "rgba(184,255,198,0.9)";
      ctx.shadowBlur = 30;
    } else if (key === "eye2") {
      ctx.shadowColor = "rgba(255,59,59,0.45)";
      ctx.shadowBlur = 18;
    } else {
      ctx.shadowColor = "rgba(75,255,106,0.35)";
      ctx.shadowBlur = 14;
    }
    if (!this.sprite(key, m.x + sx, m.y + sy, size, size)) {
      ctx.fillStyle = "#0B1E0E";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (game.chaser === "monster" && game.phase !== "result") this.drawChaserRing(ctx, m.x, m.y, m.r);
  }

  // ---------- 플레이어 ----------
  drawPlayer(ctx, game, face) {
    const p = game.player;
    const h = p.r * 2.8;
    const w = (h * 16) / 18;
    const closed = face.eyesClosed || (game.phase === "result" && game.winner === "monster");

    ctx.save();
    if (this.flicker(game)) ctx.globalAlpha = 0.45;
    if (!this.sprite(closed ? "playerClosed" : "playerOpen", p.x, p.y, w, h)) {
      ctx.fillStyle = "#D7E6CF";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.font = "18px 'Do Hyeon', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = C.greenLight;
    ctx.fillText("나", p.x, p.y + h / 2 + 4);
    ctx.restore();

    if (game.chaser === "player" && game.phase !== "result") this.drawChaserRing(ctx, p.x, p.y, p.r * 1.25);
  }

  // ---------- 시선 방향 화살표 (점선) ----------
  drawGazeArrow(ctx, game, face) {
    const mag = Math.hypot(face.moveX, face.moveY);
    if (mag < 0.05) return;
    const p = game.player;
    const dx = face.moveX / mag;
    const dy = face.moveY / mag;
    const start = p.r * 1.25 + 18;
    const len = start + 30 + 90 * mag;

    ctx.save();
    ctx.strokeStyle = "rgba(184,255,198,0.75)";
    ctx.fillStyle = "rgba(184,255,198,0.9)";
    ctx.lineWidth = 4;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x + dx * start, p.y + dy * start);
    ctx.lineTo(p.x + dx * len, p.y + dy * len);
    ctx.stroke();
    ctx.setLineDash([]);

    const ex = p.x + dx * (len + 4);
    const ey = p.y + dy * (len + 4);
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a) * 14, ey + Math.sin(a) * 14);
    ctx.lineTo(ex + Math.cos(a + 2.4) * 10, ey + Math.sin(a + 2.4) * 10);
    ctx.lineTo(ex + Math.cos(a - 2.4) * 10, ey + Math.sin(a - 2.4) * 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------- 입김 ----------
  updateWind(game, dt) {
    const p = game.player;
    const m = game.monster;
    const blowing = game.phase === "playing" && !game.paused && game.chaser === "monster" && game.blowing;
    if (blowing) {
      const a = Math.atan2(m.y - p.y, m.x - p.x);
      for (let i = 0; i < 2; i++) {
        const spread = (Math.random() - 0.5) * 0.45;
        const sp = 320 + Math.random() * 160;
        this.wind.push({
          x: p.x + Math.cos(a) * 30,
          y: p.y + Math.sin(a) * 30,
          vx: Math.cos(a + spread) * sp,
          vy: Math.sin(a + spread) * sp,
          len: 30 + Math.random() * 30,
          life: 0.6,
          max: 0.6,
        });
      }
    }
    this.windText = blowing;
    for (const q of this.wind) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
    }
    this.wind = this.wind.filter((q) => q.life > 0);
    this.windFrom = { x: p.x, y: p.y, a: Math.atan2(m.y - p.y, m.x - p.x) };
  }

  drawWind(ctx) {
    ctx.save();
    ctx.lineWidth = 3;
    for (const q of this.wind) {
      const a = q.life / q.max;
      const sp = Math.hypot(q.vx, q.vy);
      ctx.strokeStyle = `rgba(108,198,255,${a})`;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - (q.vx / sp) * q.len, q.y - (q.vy / sp) * q.len);
      ctx.stroke();
    }
    ctx.restore();

    if (this.windText && this.windFrom) {
      const { x, y, a } = this.windFrom;
      this.glowText(
        ctx,
        "후~",
        x + Math.cos(a) * 90,
        y + Math.sin(a) * 90 - 34,
        "30px 'Do Hyeon', sans-serif",
        C.blue,
        "rgba(108,198,255,0.8)"
      );
    }
  }

  // ---------- 괴물 공격 ----------
  drawFlashRays(ctx, game, atk) {
    const m = game.monster;
    const prog = Math.min(1, atk.t / atk.dur);
    const R = m.r * (2.2 + prog * 1.6);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(this.t * 0.6);
    ctx.globalAlpha = 0.25 + prog * 0.6;
    ctx.fillStyle = "rgba(220,255,226,0.6)";
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - 0.06) * R, Math.sin(a - 0.06) * R);
      ctx.lineTo(Math.cos(a + 0.06) * R, Math.sin(a + 0.06) * R);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  updateDust(game, dt) {
    const atk = game.attack;
    const m = game.monster;
    if (atk && atk.type === "dust" && atk.phase === "hit" && game.phase === "playing") {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * TAU;
        const sp = 120 + Math.random() * 260;
        this.dust.push({
          x: m.x,
          y: m.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          z: 0,
          vz: 0.9 + Math.random() * 0.8,
          c: DUST_COLORS[Math.floor(Math.random() * DUST_COLORS.length)],
        });
      }
    }
    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
    }
    this.dust = this.dust.filter((d) => d.z < 1.4);
  }

  drawAttackHit(ctx, game) {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;

    // 먼지: 화면 쪽으로 날아오며 커지는 픽셀
    for (const d of this.dust) {
      const s = Math.round(4 + d.z * d.z * 26);
      ctx.globalAlpha = Math.max(0, 1 - d.z / 1.4);
      ctx.fillStyle = d.c;
      ctx.fillRect(Math.round(d.x - s / 2), Math.round(d.y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;

    const atk = game.attack;
    if (!atk || atk.phase !== "hit") return;
    const prog = Math.min(1, atk.t / atk.dur);
    const m = game.monster;

    if (atk.type === "flash") {
      const alpha = prog < 0.15 ? prog / 0.15 : 1 - (prog - 0.15) / 0.85;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, Math.max(W, H));
      g.addColorStop(0, `rgba(240,255,242,${alpha})`);
      g.addColorStop(0.3, `rgba(184,255,198,${alpha * 0.9})`);
      g.addColorStop(0.7, `rgba(75,255,106,${alpha * 0.45})`);
      g.addColorStop(1, `rgba(75,255,106,${alpha * 0.2})`);
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    } else if (atk.type === "dust") {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, "rgba(120,140,90,0)");
      g.addColorStop(1, `rgba(120,140,90,${0.55 * Math.sin(prog * Math.PI)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (atk.type === "scare") {
      ctx.fillStyle = "rgba(255,59,59,0.14)";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      const grow = Math.min(1, prog / 0.25);
      const size = H * (0.4 + grow * 1.0);
      this.sprite("eye2", W / 2, H / 2, size, size);
    }
  }

  // ---------- 말풍선 ----------
  drawBubble(ctx, x, y, text) {
    ctx.save();
    ctx.font = "20px 'Do Hyeon', sans-serif";
    const w = ctx.measureText(text).width + 28;
    const h = 36;
    const bx = Math.max(4, Math.min(CONFIG.WIDTH - w - 4, x - w / 2));
    const by = Math.max(4, y - h / 2);
    ctx.fillStyle = "rgba(4,8,4,0.92)";
    ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, w - 2, h - 2);
    ctx.fillStyle = "#FF8A8A";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
    ctx.restore();
  }

  // ---------- 가운데 알림 ----------
  drawBanner(ctx, game) {
    if (!game.banner) return;
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    const alpha = Math.min(1, game.banner.t * 2);
    const y = Math.round(H * 0.27); // 시작 위치(가운데)의 캐릭터를 가리지 않게 위쪽에

    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = "rgba(4,8,4,0.85)";
    ctx.fillRect(0, y - 32, W, 64);
    ctx.fillStyle = C.green;
    ctx.fillRect(0, y - 32, W, 2);
    ctx.fillRect(0, y + 30, W, 2);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    this.glowText(ctx, game.banner.text, W / 2, y, "28px 'Do Hyeon', sans-serif", C.greenLight, "rgba(75,255,106,0.7)");
    ctx.restore();
  }
}
