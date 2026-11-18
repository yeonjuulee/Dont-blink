// =====================================================
// game.js — 게임 상태, 규칙, 괴물 AI, 괴물 공격, 화면 흐름
// 흐름: intro → loading → calibrating → playing ⇄ caught → result
// =====================================================
import { CONFIG } from "./config.js";
import { FaceTracker } from "./face.js";
import { MicTracker } from "./mic.js";
import { Renderer } from "./render.js";

const $ = (id) => document.getElementById(id);
const W = CONFIG.WIDTH;
const H = CONFIG.HEIGHT;

const face = new FaceTracker($("cam"));
const mic = new MicTracker();
const renderer = new Renderer($("game"));

const game = {
  phase: "intro",
  chaser: "player", // 술래: "player" | "monster"
  player: { x: W * 0.22, y: H / 2, r: CONFIG.PLAYER_RADIUS },
  monster: { x: W * 0.78, y: H / 2, r: CONFIG.MONSTER_RADIUS, heading: 0, blinkAnim: 0 },
  lives: { player: CONFIG.LIVES, monster: CONFIG.LIVES },
  dryness: 0, // 괴물 눈 건조 게이지 0~100
  dryFactor: 0,
  grace: 0,
  freeze: 0,
  time: 0,
  nextChaser: null,
  winner: null,
  banner: null,
  calibTime: 0,
  resumeFrom: null,
  blowing: false,
  paused: false,
  attack: null, // { type, cfg, phase: "warn" | "hit", t, dur }
  attackCooldown: 0,
  blinkStart: 0,
};

// =====================================================
// 화면 크기 맞추기 (1280×720 기준)
// =====================================================
function fitScreen() {
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  $("screen").style.setProperty("--s", s.toFixed(4));
}
window.addEventListener("resize", fitScreen);
fitScreen();
$("crt").hidden = !CONFIG.CRT;

// =====================================================
// 오버레이 화면
// =====================================================
let overlayKind = null;

function showOverlay(kind, html) {
  const o = $("overlay");
  o.innerHTML = html;
  o.hidden = false;
  overlayKind = kind;
}

function hideOverlay() {
  $("overlay").hidden = true;
  overlayKind = null;
}

const IMG = {
  eye0: "assets/eye_0.svg",
  eye1: "assets/eye_1.svg",
  eye2: "assets/eye_2.svg",
  eye3: "assets/eye_3.svg",
  heart: "assets/heart_full.svg",
  heartEmpty: "assets/heart_empty.svg",
  player: "assets/player_open.svg",
  playerClosed: "assets/player_closed.svg",
};

function heartsHTML(n, cls = "") {
  let s = "";
  for (let i = 0; i < CONFIG.LIVES; i++) {
    const full = i < n;
    s += `<img class="${cls}" src="${full ? IMG.heart : IMG.heartEmpty}" alt="${full ? "목숨" : "잃은 목숨"}">`;
  }
  return s;
}

// ---------- 타이틀 ----------
function showTitle(errorHtml = "") {
  game.phase = "intro";
  showOverlay(
    "title",
    `
    <div class="screen-bg"></div>
    <div class="screen-grid"></div>
    <div class="frame-line"></div>
    <span class="corner-tag" style="left: 48px">REC ● CAM 01</span>
    <span class="corner-tag" style="right: 48px">MIC ▮▮▮▯</span>

    <div class="center-col" style="top: 64px; gap: 6px">
      <img class="title-eye pixel float" src="${IMG.eye0}" alt="괴물의 눈">
      <h1 class="title-name glow">DON'T BLINK</h1>
      <p class="title-sub">깜빡이면 술래</p>
    </div>

    <div class="center-col" style="top: 506px; gap: 14px">
      ${errorHtml}
      <button id="startBtn" class="btn"><span class="cursor">▶</span>START</button>
    </div>

    <div class="center-col" style="bottom: 40px; gap: 8px">
      <div class="title-rules">
        <span>LOOK = 이동</span><span class="sep">/</span>
        <span>BLINK = 역할 교체</span><span class="sep">/</span>
        <span>BLOW = 괴물 눈 말리기</span>
      </div>
      <span class="title-warn">주의: 번쩍이는 화면 효과가 있어요. 빛에 민감하면 플레이하지 마세요.</span>
    </div>
  `
  );
}

function showLoading() {
  showOverlay(
    "loading",
    `
    <div class="screen-bg"></div>
    <div class="screen-grid"></div>
    <div class="center-col" style="top: 250px; gap: 18px">
      <h1 class="big-title glow" style="font-size: 64px">LOADING<span class="cursor">_</span></h1>
      <p class="result-msg" style="font-size: 24px">카메라와 마이크 권한을 허용해 주세요</p>
      <p class="title-warn">처음에는 얼굴 인식 모델을 받느라 10초 정도 걸릴 수 있어요</p>
    </div>
  `
  );
}

// ---------- 보정 ----------
function showCalibration() {
  showOverlay(
    "calibration",
    `
    <div class="calib">
      <div class="calib-head">
        <h1 class="glow">CALIBRATION</h1>
        <span>기준점 맞추기 · ${CONFIG.CALIBRATION_TIME}초</span>
      </div>

      <div class="calib-grid">
        <section class="calib-card">
          <h2>STEP 1. <span>카메라 보정</span></h2>
          <div style="display: flex; gap: 16px">
            <div class="calib-cam">
              <video id="calCam" playsinline muted></video>
              <div class="guide"></div>
              <div class="cross-h"></div><div class="cross-v"></div>
              <div class="corner tl"></div><div class="corner tr"></div>
              <div class="corner bl"></div><div class="corner br"></div>
            </div>
            <div class="readouts">
              <div class="readout" id="rowFace"><span>얼굴 인식</span><span id="rdFace">-</span></div>
              <div class="readout"><span>눈 깜빡임 값</span><span id="rdBlink">-</span></div>
              <div class="readout"><span>시선 방향</span><span id="rdGaze">-</span></div>
              <div class="readout"><span>입 모양</span><span id="rdMouth">-</span></div>
              <p class="calib-note">눈을 편하게 뜬 채 화면 가운데를 봐 주세요</p>
            </div>
          </div>
        </section>

        <section class="calib-card">
          <h2>STEP 2. <span>마이크 보정</span></h2>
          <canvas id="wave" class="wave" width="520" height="150"></canvas>
          <div class="readouts">
            <div class="readout"><span>주변 소음</span><span id="rdNoise">-</span></div>
            <div class="readout"><span>평탄도</span><span id="rdFlat">-</span></div>
            <div class="readout"><span>판정</span><span id="rdMic">-</span></div>
          </div>
        </section>
      </div>

      <div class="calib-foot">
        <span id="calibMsg" class="calib-msg">가만히, 조용히 있어 주세요</span>
        <div class="calib-progress"><div id="calibBar"></div></div>
        <span id="calibCount" class="calib-count glow">${CONFIG.CALIBRATION_TIME}</span>
      </div>
    </div>
  `
  );

  const v = $("calCam");
  v.srcObject = $("cam").srcObject;
  v.play().catch(() => {});
}

// ---------- 일시정지 (얼굴이 안 보일 때) ----------
function showPaused() {
  showOverlay(
    "paused",
    `
    <div class="dim-layer"></div>
    <div class="center-col" style="top: 96px; gap: 18px">
      <h1 class="big-title glow">PAUSED</h1>
      <div class="face-lost">
        <div class="face-box"><span class="cursor">?</span></div>
        <div class="lines">
          <span>얼굴이 보이지 않아요</span>
          <span>카메라 정면에 앉으면 자동으로 다시 시작해요</span>
        </div>
      </div>
      <nav class="menu">
        <button id="recalPauseBtn" class="btn ghost">RECALIBRATE</button>
        <button id="exitBtn" class="btn ghost dim">EXIT TO TITLE</button>
      </nav>
    </div>
    <p class="center-col title-warn" style="bottom: 40px; margin: 0; font-size: 20px">얼굴을 숨기면 깜빡임을 피할 수 없어요 · 게임이 멈춰요</p>
  `
  );
}

// ---------- 결과 ----------
function showResult(winner) {
  const blinks = face.state.blinkCount - game.blinkStart;
  if (winner === "player") {
    showOverlay(
      "result",
      `
      <div class="win-bg"></div>
      <span class="twinkle" style="left: 260px; top: 150px"></span>
      <span class="twinkle" style="left: 980px; top: 120px; animation-delay: .4s"></span>
      <span class="twinkle" style="left: 1040px; top: 420px; width: 6px; height: 6px; animation-delay: .8s"></span>
      <span class="twinkle" style="left: 190px; top: 460px; width: 6px; height: 6px; animation-delay: .2s"></span>
      <div class="center-col" style="top: 56px; gap: 10px">
        <h1 class="result-title glow">YOU WIN!</h1>
        <img class="pixel" src="${IMG.eye3}" alt="눈을 감은 괴물" style="width: 250px; height: 250px; filter: drop-shadow(0 0 20px rgba(75,255,106,.4))">
        <p class="result-msg">괴물의 눈이 완전히 감겼어요</p>
        <div class="stats">
          <span>TIME <b>${fmtTime(game.time)}</b></span><span class="sep">|</span>
          <span class="mini-hearts">HP ${heartsHTML(game.lives.player)}</span><span class="sep">|</span>
          <span>BLINKS <b>${blinks}</b></span>
        </div>
        <button id="restartBtn" class="btn" style="width: 280px; height: 56px; font-size: 24px"><span class="cursor">▶</span>RESTART</button>
      </div>
    `
    );
  } else {
    showOverlay(
      "result",
      `
      <div class="lose-bg"></div>
      <img class="pixel" src="${IMG.eye2}" alt="" style="position: absolute; left: 50%; top: 150px; width: 400px; height: 400px; margin-left: -200px; opacity: .28">
      <div class="center-col" style="top: 56px">
        <h1 class="result-title lose">GAME OVER</h1>
        <div class="drips"><span></span><span></span><span></span><span></span></div>
      </div>
      <img class="pixel" src="${IMG.playerClosed}" alt="잡힌 플레이어" style="position: absolute; left: 50%; top: 300px; width: 128px; height: 144px; margin-left: -64px; filter: grayscale(.4) brightness(.8)">
      <div class="center-col" style="top: 470px; gap: 14px">
        <p class="result-msg lose">잡혔다… 목숨을 모두 잃었어요</p>
        <div class="stats lose">
          <span>TIME <b>${fmtTime(game.time)}</b></span><span class="sep">|</span>
          <span>MONSTER HP <b>${game.lives.monster}</b></span><span class="sep">|</span>
          <span>BLINKS <b>${blinks}</b></span>
        </div>
        <button id="restartBtn" class="btn red" style="width: 280px; height: 56px; font-size: 24px"><span class="cursor">▶</span>RESTART</button>
      </div>
    `
    );
  }
}

// ---------- 버튼 ----------
$("overlay").addEventListener("click", (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "startBtn") start();
  if (id === "restartBtn") newGame();
  if (id === "recalPauseBtn") recalibrate("playing");
  if (id === "exitBtn") showTitle();
});

$("recalBtn").addEventListener("click", () => recalibrate(game.phase));

function recalibrate(from) {
  if (!face.state.ready || !mic.ready) return;
  if (game.phase === "loading" || game.phase === "calibrating") return;
  game.resumeFrom = from;
  startCalibration();
}

// 개발용 패널(카메라 미리보기, 재보정 버튼, 디버그) 열고 닫기
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "d") return;
  const open = $("debug").hidden;
  $("debug").hidden = !open;
  $("dev").classList.toggle("collapsed", !open);
});

// =====================================================
// 시작
// =====================================================
async function start() {
  // 이미 카메라와 마이크가 켜져 있으면 바로 보정으로
  if (face.state.ready && mic.ready) {
    game.resumeFrom = null;
    startCalibration();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showTitle(`<div class="error-box">파일을 더블클릭해서 열면 카메라와 마이크가 막혀요.<br>VS Code Live Server처럼 localhost 주소로 열어 주세요.</div>`);
    return;
  }

  game.phase = "loading";
  showLoading();

  try {
    await mic.init(); // 클릭 직후 오디오를 먼저 열어야 브라우저가 막지 않음
    await face.init();
    $("recalBtn").disabled = false;
    game.resumeFrom = null;
    startCalibration();
  } catch (err) {
    console.error(err);
    showTitle(`<div class="error-box">${errorMessage(err)}</div>`);
  }
}

function errorMessage(err) {
  if (err?.name === "NotAllowedError") return "카메라 또는 마이크 권한이 거부됐어요. 주소창 왼쪽 아이콘에서 허용해 주세요.";
  if (err?.name === "NotFoundError") return "카메라 또는 마이크를 찾을 수 없어요.";
  if (err?.name === "NotReadableError") return "다른 프로그램이 카메라를 쓰고 있어요. 줌이나 다른 탭을 닫아 주세요.";
  return `오류: ${err?.message || err}`;
}

// =====================================================
// 보정 (기준점 측정)
// =====================================================
function startCalibration() {
  game.phase = "calibrating";
  game.calibTime = 0;
  game.attack = null;
  face.startCalibration();
  mic.startCalibration();
  showCalibration();
}

function updateCalibration(dt, fs, ms) {
  updateCalibrationReadouts(fs, ms);

  const msg = $("calibMsg");
  if (!fs.faceFound) {
    if (msg) msg.textContent = "얼굴이 보이지 않아요. 카메라 정면에 앉아 주세요";
    return;
  }

  face.addCalibrationSample();
  mic.addCalibrationSample();
  game.calibTime += dt;

  const left = Math.max(0, Math.ceil(CONFIG.CALIBRATION_TIME - game.calibTime));
  if (msg) msg.textContent = "가만히, 조용히 있어 주세요";
  const count = $("calibCount");
  if (count) count.textContent = left;
  const bar = $("calibBar");
  if (bar) bar.style.width = `${Math.min(1, game.calibTime / CONFIG.CALIBRATION_TIME) * 100}%`;

  if (game.calibTime >= CONFIG.CALIBRATION_TIME) {
    face.finishCalibration();
    mic.finishCalibration();
    finishCalibrationFlow();
  }
}

function updateCalibrationReadouts(fs, ms) {
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  set("rdFace", fs.faceFound ? "OK" : "NO FACE");
  $("rowFace")?.classList.toggle("bad", !fs.faceFound);
  set("rdBlink", fs.blink.toFixed(2));
  const off = Math.hypot(fs.moveX, fs.moveY) < 0.15;
  set("rdGaze", !fs.faceFound ? "-" : off ? "CENTER" : "MOVING");
  set("rdMouth", fs.pucker.toFixed(2));
  set("rdNoise", ms.volume.toFixed(3));
  set("rdFlat", ms.flatness.toFixed(2));
  set("rdMic", ms.isBlowing ? "BLOW" : ms.isVoice ? "VOICE" : "QUIET");
  drawWave();
}

// 보정 화면의 마이크 파형
function drawWave() {
  const cv = $("wave");
  const buf = mic.getWaveform();
  if (!cv || !buf) return;
  const ctx = cv.getContext("2d");
  const bars = 48;
  const gap = 4;
  const bw = (cv.width - gap * (bars + 1)) / bars;
  const chunk = Math.floor(buf.length / bars);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#4BFF6A";
  ctx.shadowColor = "rgba(75,255,106,0.6)";
  ctx.shadowBlur = 6;
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = 0; j < chunk; j++) peak = Math.max(peak, Math.abs(buf[i * chunk + j]));
    const h = Math.max(4, Math.min(cv.height - 10, peak * cv.height * 6));
    ctx.fillRect(Math.round(gap + i * (bw + gap)), Math.round((cv.height - h) / 2), Math.ceil(bw), Math.round(h));
  }
}

// 보정이 끝나면, 재보정을 누르기 전 상태로 돌아감
function finishCalibrationFlow() {
  const from = game.resumeFrom;
  game.resumeFrom = null;

  if (from === "playing") {
    game.phase = "playing";
    game.grace = CONFIG.SWAP_GRACE;
    hideOverlay();
    setBanner("기준점을 다시 맞췄어요. 계속!", 1.5);
  } else if (from === "caught") {
    hideOverlay();
    resumeAfterCatch();
  } else if (from === "result") {
    endGame(game.winner);
  } else {
    newGame();
  }
}

// =====================================================
// 게임 진행
// =====================================================
function newGame() {
  game.lives.player = CONFIG.LIVES;
  game.lives.monster = CONFIG.LIVES;
  game.chaser = "player";
  game.time = 0;
  game.winner = null;
  game.blinkStart = face.state.blinkCount;
  resetRound();
  game.phase = "playing";
  hideOverlay();
  setBanner("당신이 술래! 깜빡이지 말고 쫓아가세요", 2);
}

function resetRound() {
  Object.assign(game.player, { x: W * 0.22, y: H / 2 });
  Object.assign(game.monster, { x: W * 0.78, y: H / 2, heading: 0, blinkAnim: 0 });
  game.dryness = 0;
  game.grace = CONFIG.SWAP_GRACE;
  game.attack = null;
  game.attackCooldown = nextAttackCooldown();
}

function setBanner(text, seconds) {
  game.banner = { text, t: seconds };
}

function updatePlaying(dt, fs) {
  // 얼굴이 안 보이면 일시정지 (얼굴을 숨겨서 깜빡임을 피하는 것 방지)
  game.paused = !fs.faceFound;
  if (game.paused) {
    if (overlayKind !== "paused") showPaused();
    return;
  }
  if (overlayKind === "paused") hideOverlay();

  game.time += dt;
  game.grace = Math.max(0, game.grace - dt);

  movePlayer(dt, fs);
  moveMonster(dt);

  if (game.chaser === "player") {
    game.dryness = 0;
    updateAttack(dt);
    if (fs.blinkEvent) swapRoles("player");
  } else {
    game.attack = null;
    updateDryness(dt, fs);
  }

  checkCatch();
}

function movePlayer(dt, fs) {
  const p = game.player;
  p.x += fs.moveX * CONFIG.PLAYER_SPEED * dt;
  p.y += fs.moveY * CONFIG.PLAYER_SPEED * dt;
  clampToArena(p);
}

// ---------- 괴물 AI ----------
function moveMonster(dt) {
  const m = game.monster;
  const p = game.player;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const d = Math.hypot(dx, dy) || 1;

  if (m.blinkAnim > 0) return; // 깜빡이는 동안은 멈춤

  if (game.chaser === "monster") {
    // 쫓기: 플레이어에게 곧장
    m.heading = Math.atan2(dy, dx);
    m.x += (dx / d) * CONFIG.MONSTER_CHASE_SPEED * dt;
    m.y += (dy / d) * CONFIG.MONSTER_CHASE_SPEED * dt;
  } else {
    // 도망: 16방향 중 플레이어와 멀어지고 벽에서 먼 방향 선택
    let bestA = m.heading;
    let bestScore = -Infinity;
    const look = 60;
    const margin = 90;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const nx = m.x + Math.cos(a) * look;
      const ny = m.y + Math.sin(a) * look;
      let score = Math.hypot(nx - p.x, ny - p.y);
      const wall = Math.min(nx - m.r, W - m.r - nx, ny - m.r, H - m.r - ny);
      if (wall < margin) score -= (margin - wall) * 2.5;
      if (inUiZone(nx, ny, m.r)) score -= 400; // 패널 밑으로 숨지 않게
      score += Math.cos(a - m.heading) * 8; // 방향을 너무 자주 바꾸지 않게
      if (score > bestScore) {
        bestScore = score;
        bestA = a;
      }
    }
    m.heading = bestA;
    const speed = CONFIG.MONSTER_FLEE_SPEED * (d > CONFIG.MONSTER_RELAX_DIST ? 0.5 : 1);
    m.x += Math.cos(bestA) * speed * dt;
    m.y += Math.sin(bestA) * speed * dt;
  }
  clampToArena(m);
}

// 맵 위에 겹쳐 있는 패널 영역 (괴물 눈 건조 패널, 안내 메시지, 입력 표시, 시간)
const UI_ZONES = [
  { x: W - 225, y: 0, w: 225, h: 250 },
  { x: 0, y: H - 90, w: 370, h: 90 },
  { x: W / 2 - 210, y: H - 80, w: 420, h: 80 },
  { x: W - 170, y: H - 90, w: 170, h: 90 },
];

function inUiZone(x, y, r) {
  return UI_ZONES.some((z) => x > z.x - r && x < z.x + z.w + r && y > z.y - r && y < z.y + z.h + r);
}

function clampToArena(o) {
  o.x = Math.max(o.r, Math.min(W - o.r, o.x));
  o.y = Math.max(o.r, Math.min(H - o.r, o.y));
}

// ---------- 괴물의 공격 (내가 술래일 때) ----------
const ATTACKS = [
  ["flash", () => CONFIG.ATTACK_FLASH],
  ["dust", () => CONFIG.ATTACK_DUST],
  ["scare", () => CONFIG.ATTACK_SCARE],
];

function nextAttackCooldown() {
  const base =
    CONFIG.ATTACK_COOLDOWN_MIN + Math.random() * (CONFIG.ATTACK_COOLDOWN_MAX - CONFIG.ATTACK_COOLDOWN_MIN);
  const d = Math.hypot(game.player.x - game.monster.x, game.player.y - game.monster.y);
  const far = clamp(d / 600, 0, 1);
  return base * (CONFIG.ATTACK_NEAR_FASTER + (1 - CONFIG.ATTACK_NEAR_FASTER) * far);
}

function startAttack() {
  const total = ATTACKS.reduce((s, [, cfg]) => s + cfg().weight, 0);
  let r = Math.random() * total;
  let pick = ATTACKS[0];
  for (const a of ATTACKS) {
    r -= a[1]().weight;
    if (r <= 0) {
      pick = a;
      break;
    }
  }
  const [type, getCfg] = pick;
  const cfg = getCfg();
  const warn = cfg.warn > 0;
  game.attack = { type, cfg, phase: warn ? "warn" : "hit", t: 0, dur: warn ? cfg.warn : cfg.hit };
}

function updateAttack(dt) {
  if (!CONFIG.ATTACK_ENABLED) {
    game.attack = null;
    return;
  }
  const a = game.attack;
  if (a) {
    a.t += dt;
    if (a.t >= a.dur) {
      if (a.phase === "warn") {
        a.phase = "hit";
        a.t = 0;
        a.dur = a.cfg.hit;
      } else {
        game.attack = null;
        game.attackCooldown = nextAttackCooldown();
      }
    }
    return;
  }
  if (game.grace > 0) return;
  game.attackCooldown -= dt;
  if (game.attackCooldown <= 0) startAttack();
}

// ---------- 괴물 눈 건조 ----------
function updateDryness(dt, fs) {
  const p = game.player;
  const m = game.monster;
  const d = Math.hypot(p.x - m.x, p.y - m.y);

  // 게임 속 거리가 가까울수록 효과 큼
  const t = clamp((CONFIG.DRY_FAR_DIST - d) / (CONFIG.DRY_FAR_DIST - CONFIG.DRY_NEAR_DIST), 0, 1);
  const distFactor = CONFIG.DRY_MIN_FACTOR + (CONFIG.DRY_MAX_FACTOR - CONFIG.DRY_MIN_FACTOR) * t;
  // 실제로 화면에 가까이 다가가면 조금 더 효과 큼
  const faceFactor = clamp(fs.closeness, 0.8, 1.5);
  game.dryFactor = distFactor * faceFactor;

  if (game.blowing) game.dryness += CONFIG.DRY_RATE * game.dryFactor * dt;
  else game.dryness -= CONFIG.DRY_DECAY * dt;
  game.dryness = clamp(game.dryness, 0, 100);

  if (game.dryness >= 100) {
    game.monster.blinkAnim = 0.5;
    swapRoles("monster");
  }
}

function swapRoles(blinker) {
  game.chaser = game.chaser === "player" ? "monster" : "player";
  game.grace = CONFIG.SWAP_GRACE;
  game.dryness = 0;
  game.attack = null;
  game.attackCooldown = nextAttackCooldown();
  if (blinker === "player") setBanner("깜빡! 이제 괴물이 술래예요. 후~ 불어서 눈을 말리세요", 2);
  else setBanner("괴물이 깜빡였어요! 이제 당신이 술래예요", 2);
}

// ---------- 잡기 ----------
function checkCatch() {
  if (game.grace > 0) return;
  const p = game.player;
  const m = game.monster;
  if (Math.hypot(p.x - m.x, p.y - m.y) >= p.r + m.r) return;

  const loser = game.chaser === "player" ? "monster" : "player";
  game.lives[loser]--;
  game.nextChaser = loser; // 잡힌 쪽이 다음 술래
  game.attack = null;

  if (game.lives[loser] <= 0) {
    endGame(loser === "monster" ? "player" : "monster");
    return;
  }

  game.phase = "caught";
  game.freeze = CONFIG.CAUGHT_FREEZE;
  setBanner(loser === "monster" ? "잡았다! 괴물 목숨 -1" : "잡혔다! 내 목숨 -1", CONFIG.CAUGHT_FREEZE);
}

function resumeAfterCatch() {
  resetRound();
  game.chaser = game.nextChaser;
  game.phase = "playing";
  setBanner(game.chaser === "player" ? "이번엔 당신이 술래!" : "이번엔 괴물이 술래! 도망치며 후~", 1.5);
}

// ---------- 결과 ----------
function endGame(winner) {
  game.phase = "result";
  game.winner = winner;
  game.banner = null;
  game.attack = null;
  showResult(winner);
}

// =====================================================
// 메인 루프
// =====================================================
// 입김 판정: 바람 소리(마이크)와 입 모양(카메라)을 BLOW_MODE에 따라 합침
function computeBlowing(fs, ms) {
  const sound = ms.isBlowing;
  const mouth = fs.faceFound && fs.mouthBlow;
  switch (CONFIG.BLOW_MODE) {
    case "both":
      return sound && mouth;
    case "mic":
      return sound;
    case "mouth":
      return mouth;
    default:
      return sound || mouth;
  }
}

function update(dt, fs, ms) {
  game.blowing = computeBlowing(fs, ms);

  if (game.banner) {
    game.banner.t -= dt;
    if (game.banner.t <= 0) game.banner = null;
  }
  if (game.monster.blinkAnim > 0) game.monster.blinkAnim -= dt;

  switch (game.phase) {
    case "calibrating":
      updateCalibration(dt, fs, ms);
      break;
    case "playing":
      updatePlaying(dt, fs);
      break;
    case "caught":
      game.freeze -= dt;
      if (game.freeze <= 0) resumeAfterCatch();
      break;
  }
}

// ---------- HUD ----------
let lastHearts = "";
function updateHUD(fs, ms) {
  // 목숨 (바뀔 때만 다시 그림)
  const key = `${game.lives.player}/${game.lives.monster}`;
  if (key !== lastHearts) {
    $("livesPlayer").innerHTML = heartsHTML(game.lives.player);
    $("livesMonster").innerHTML = heartsHTML(game.lives.monster);
    lastHearts = key;
  }

  // 역할
  const playerChaser = game.chaser === "player";
  const role = $("roleBox");
  role.classList.toggle("chaser", playerChaser);
  $("roleName").textContent = playerChaser ? "CHASER" : "RUNNER";
  $("roleSub").textContent = playerChaser ? "당신이 술래" : "괴물이 술래 · 도망쳐요";

  // 괴물 눈 건조 패널
  const d = game.dryness;
  const panel = $("dryPanel");
  panel.classList.toggle("active", !playerChaser);
  panel.classList.toggle("inactive", playerChaser);
  const stage = playerChaser ? IMG.eye0 : d >= 80 ? IMG.eye2 : d >= 50 ? IMG.eye1 : IMG.eye0;
  const eye = $("dryEye");
  if (!eye.src.endsWith(stage)) eye.src = stage;
  $("dryBar").style.width = `${d}%`;
  $("dryText").textContent = `${Math.round(d)}%`;
  $("dryHint").textContent = playerChaser ? "쫓길 때만 작동" : d >= 80 ? "곧 깜빡여요!" : "후~ 불어서 말리세요";

  // 안내 메시지
  const msg = $("msgBox");
  msg.classList.toggle("blow", !playerChaser);
  if (playerChaser) {
    $("msgTitle").textContent = game.attack ? "HOLD YOUR EYES" : "LOOK TO MOVE";
    $("msgSub").textContent = game.attack ? "공격을 버티세요" : "깜빡이면 술래가 바뀌어요";
  } else {
    $("msgTitle").textContent = "BLOW TO DRY";
    $("msgSub").textContent = "가까이서 불수록 빨리 말라요";
  }

  // 입력 감지 표시 (조건 04)
  const input = $("inputBox");
  input.classList.remove("closed", "blowing", "voice");
  if (playerChaser) {
    if (fs.eyesClosed) input.classList.add("closed");
    $("inputMain").textContent = !fs.faceFound ? "NO FACE" : fs.eyesClosed ? "EYES SHUT" : "EYES OPEN";
    $("inputSub").textContent = `BLINKS ${String(Math.max(0, fs.blinkCount - game.blinkStart)).padStart(2, "0")}`;
  } else if (game.blowing) {
    input.classList.add("blowing");
    $("inputMain").textContent = "BLOW DETECTED";
    $("inputSub").textContent = ms.isBlowing && fs.mouthBlow ? "MIC + MOUTH" : ms.isBlowing ? "MIC" : "MOUTH";
  } else if (ms.isVoice) {
    input.classList.add("voice");
    $("inputMain").textContent = "VOICE";
    $("inputSub").textContent = "바람만 인정돼요";
  } else {
    $("inputMain").textContent = "후~ 불어 보세요";
    $("inputSub").textContent = "MIC + MOUTH";
  }

  $("timer").textContent = fmtTime(game.time);

  // 공격 경고
  const warn = $("attackWarn");
  const a = game.attack;
  warn.hidden = !(a && game.phase === "playing" && !game.paused);
  if (a) {
    const names = { flash: "!! FLASH ATTACK !!", dust: "!! DUST STORM !!", scare: "!! BOO !!" };
    $("attackName").textContent = names[a.type];
    $("attackSub").textContent =
      a.phase === "warn" ? "눈을 감지 말고 버티세요" : `버티세요 ${Math.max(0, a.dur - a.t).toFixed(1)}s`;
  }

  // 개발용 패널 배지
  $("eyeIcon").textContent = !fs.ready ? "EYE …" : !fs.faceFound ? "EYE ?" : fs.eyesClosed ? "EYE —" : "EYE ●";
  $("micIcon").textContent = !ms.ready ? "MIC …" : ms.isBlowing ? "MIC ~" : ms.isVoice ? "MIC !" : "MIC ·";
  $("mouthIcon").textContent = !fs.ready ? "O …" : fs.mouthBlow ? "O ●" : "O ·";
  $("camWrap").classList.toggle("blowing", game.blowing);
}

// ---------- 디버그 ----------
let fps = 60;
function updateDebug(fs, ms, dt) {
  const el = $("debug");
  if (el.hidden) return;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  const f = (v, n = 2) => (Number.isFinite(v) ? v : 0).toFixed(n);

  el.textContent = [
    "[디버그]  D 키로 숨기기",
    `FPS        화면 ${f(fps, 0)} / 얼굴 분석 ${fs.detectFps}`,
    "",
    "── 얼굴 ──",
    `얼굴 인식   ${fs.faceFound ? "O" : "X"}`,
    `깜빡임 값   ${f(fs.blink)} / 기준 ${f(fs.blinkThreshold)}`,
    `최근 최고값 ${f(fs.blinkPeak)}   눈 뜬 값 ${fs.blinkBase == null ? "-" : f(fs.blinkBase)}`,
    `눈 상태     ${fs.eyesClosed ? "감음" : "뜸"}  (횟수 ${fs.blinkCount})`,
    `고개 X/Y    ${f(fs.headX)} / ${f(fs.headY)}`,
    `시선 X/Y    ${f(fs.gazeX)} / ${f(fs.gazeY)}`,
    `이동 X/Y    ${f(fs.moveX)} / ${f(fs.moveY)}`,
    `가까움      ${f(fs.closeness)}`,
    "",
    "── 마이크 ──",
    `볼륨        ${f(ms.volume, 3)} / 기준 ${f(ms.threshold, 3)}`,
    `평탄도      ${f(ms.flatness)}`,
    `            입김 ≥ ${CONFIG.BREATH_MIN_FLATNESS}, 목소리 ≤ ${CONFIG.VOICE_MAX_FLATNESS}`,
    `판정        ${ms.isBlowing ? "입김" : ms.isVoice ? "목소리" : "-"}`,
    "",
    "── 입 모양 ──",
    `오므림      ${f(fs.pucker)} / 기준 ${f(fs.mouthThreshold)}`,
    `입 벌림     ${f(fs.jawOpen)} / 최대 ${CONFIG.MOUTH_MAX_JAW}`,
    `판정        ${fs.mouthBlow ? "바람 입 모양" : "-"}`,
    "",
    `최종 입김   ${game.blowing ? "O" : "-"}   (방식: ${CONFIG.BLOW_MODE})`,
    "",
    "── 게임 ──",
    `단계        ${game.phase}`,
    `술래        ${game.chaser === "player" ? "나" : "괴물"}`,
    `눈 건조     ${f(game.dryness, 0)}%  (배율 ${f(game.dryFactor)})`,
    `공격        ${game.attack ? `${game.attack.type} ${game.attack.phase}` : `대기 ${f(game.attackCooldown, 1)}s`}`,
  ].join("\n");
}

// ---------- 유틸 ----------
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fmtTime(sec) {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---------- 루프 시작 ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const fs = face.update();
  const ms = mic.update(dt);

  update(dt, fs, ms);
  renderer.draw(game, fs, ms, dt);
  updateHUD(fs, ms);
  updateDebug(fs, ms, dt);

  requestAnimationFrame(loop);
}

showTitle();
requestAnimationFrame(loop);
