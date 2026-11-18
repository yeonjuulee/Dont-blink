// =====================================================
// game.js — 게임 상태, 규칙, 괴물 AI, 화면 흐름
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
  paused: false,
};

// =====================================================
// 화면(오버레이)
// =====================================================
function showOverlay(html) {
  const o = $("overlay");
  o.innerHTML = html;
  o.hidden = false;
}

function hideOverlay() {
  $("overlay").hidden = true;
}

function showIntro() {
  showOverlay(`
    <h1>Don't Blink</h1>
    <p class="sub">깜빡이면 술래</p>
    <ul class="rules">
      <li>👀 보는 곳으로 움직여요 (고개와 눈)</li>
      <li>😑 술래가 눈을 깜빡이면 역할이 바뀌어요</li>
      <li>🌬️ 괴물은 스스로 깜빡이지 않아요. 쫓길 때는 화면에 <b>후~</b> 불어서 눈을 말리세요</li>
      <li>❤️ 목숨 3개를 먼저 다 잃는 쪽이 져요</li>
    </ul>
    <button id="startBtn">카메라 · 마이크 켜고 시작</button>
    <p class="note">버튼은 권한을 허용하려고 한 번만 눌러요. 게임은 몸으로만 해요.</p>
  `);
}

$("overlay").addEventListener("click", (e) => {
  if (e.target.id === "startBtn") start();
  if (e.target.id === "restartBtn") newGame();
});

// 재보정 버튼: 게임 중에 눌러도 진행 상황은 그대로 두고 기준점만 다시 맞춤
$("recalBtn").addEventListener("click", () => {
  if (!face.state.ready || !mic.ready) return;
  if (game.phase === "loading" || game.phase === "calibrating") return;
  game.resumeFrom = game.phase;
  startCalibration();
});

// 디버그 패널 켜고 끄기 (개발용)
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "d") $("debug").hidden = !$("debug").hidden;
});

// =====================================================
// 시작
// =====================================================
async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showOverlay(`
      <h2>카메라를 쓸 수 없어요</h2>
      <p>파일을 더블클릭해서 열면 카메라와 마이크가 막혀요.<br>
      VS Code Live Server처럼 <b>localhost</b> 주소로 열어 주세요.</p>
    `);
    return;
  }

  game.phase = "loading";
  showOverlay(`
    <h2>준비 중…</h2>
    <p>카메라와 마이크 권한을 허용해 주세요.</p>
    <p class="note">처음에는 얼굴 인식 모델을 받느라 10초 정도 걸릴 수 있어요.</p>
  `);

  try {
    await mic.init(); // 클릭 직후 오디오를 먼저 열어야 브라우저가 막지 않음
    await face.init();
    $("recalBtn").disabled = false;
    game.resumeFrom = null;
    startCalibration();
  } catch (err) {
    console.error(err);
    game.phase = "intro";
    showOverlay(`
      <h2>시작하지 못했어요</h2>
      <p>${errorMessage(err)}</p>
      <button id="startBtn">다시 시도</button>
    `);
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
  face.startCalibration();
  mic.startCalibration();
  showOverlay(`
    <h2>기준점 맞추기</h2>
    <p id="calibMsg">화면 가운데를 보고, 눈을 편하게 뜬 채 조용히 있어 주세요…</p>
    <div class="hold"><div id="calibBar"></div></div>
  `);
}

function updateCalibration(dt, fs) {
  const msg = $("calibMsg");
  if (!fs.faceFound) {
    if (msg) msg.textContent = "얼굴이 보이지 않아요. 카메라 정면에 앉아 주세요.";
    return;
  }

  face.addCalibrationSample();
  mic.addCalibrationSample();
  game.calibTime += dt;

  const left = Math.max(0, Math.ceil(CONFIG.CALIBRATION_TIME - game.calibTime));
  if (msg) msg.textContent = `화면 가운데를 보고, 눈을 편하게 뜬 채 조용히 있어 주세요… ${left}`;
  const bar = $("calibBar");
  if (bar) bar.style.width = `${Math.min(1, game.calibTime / CONFIG.CALIBRATION_TIME) * 100}%`;

  if (game.calibTime >= CONFIG.CALIBRATION_TIME) {
    face.finishCalibration();
    mic.finishCalibration();
    finishCalibrationFlow();
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
}

function setBanner(text, seconds) {
  game.banner = { text, t: seconds };
}

function updatePlaying(dt, fs, ms) {
  // 얼굴이 안 보이면 일시정지 (얼굴을 숨겨서 깜빡임을 피하는 것 방지)
  game.paused = !fs.faceFound;
  if (game.paused) return;

  game.time += dt;
  game.grace = Math.max(0, game.grace - dt);

  movePlayer(dt, fs);
  moveMonster(dt);

  if (game.chaser === "player") {
    game.dryness = 0;
    if (fs.blinkEvent) swapRoles("player");
  } else {
    updateDryness(dt, fs, ms);
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
    const look = 50;
    const margin = 70;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const nx = m.x + Math.cos(a) * look;
      const ny = m.y + Math.sin(a) * look;
      let score = Math.hypot(nx - p.x, ny - p.y);
      const wall = Math.min(nx - m.r, W - m.r - nx, ny - m.r, H - m.r - ny);
      if (wall < margin) score -= (margin - wall) * 2.5;
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

function clampToArena(o) {
  o.x = Math.max(o.r, Math.min(W - o.r, o.x));
  o.y = Math.max(o.r, Math.min(H - o.r, o.y));
}

// ---------- 괴물 눈 건조 ----------
function updateDryness(dt, fs, ms) {
  const p = game.player;
  const m = game.monster;
  const d = Math.hypot(p.x - m.x, p.y - m.y);

  // 게임 속 거리가 가까울수록 효과 큼
  const t = clamp((CONFIG.DRY_FAR_DIST - d) / (CONFIG.DRY_FAR_DIST - CONFIG.DRY_NEAR_DIST), 0, 1);
  const distFactor = CONFIG.DRY_MIN_FACTOR + (CONFIG.DRY_MAX_FACTOR - CONFIG.DRY_MIN_FACTOR) * t;
  // 실제로 화면에 가까이 다가가면 조금 더 효과 큼
  const faceFactor = clamp(fs.closeness, 0.8, 1.5);
  game.dryFactor = distFactor * faceFactor;

  if (ms.isBlowing) game.dryness += CONFIG.DRY_RATE * game.dryFactor * dt;
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
  setBanner(
    game.chaser === "player" ? "이번엔 당신이 술래!" : "이번엔 괴물이 술래! 도망치며 후~",
    1.5
  );
}

// ---------- 결과 ----------
function endGame(winner) {
  game.phase = "result";
  game.winner = winner;
  game.banner = null;
  const win = winner === "player";
  showOverlay(`
    <h1>${win ? "승리!" : "패배…"}</h1>
    <p>${win ? "괴물의 목숨을 모두 빼앗았어요." : "괴물에게 목숨을 모두 잃었어요."}</p>
    <p class="note">플레이 시간 ${fmtTime(game.time)}</p>
    <button id="restartBtn">다시 시작</button>
  `);
}

// =====================================================
// 메인 루프
// =====================================================
function update(dt, fs, ms) {
  if (game.banner) {
    game.banner.t -= dt;
    if (game.banner.t <= 0) game.banner = null;
  }
  if (game.monster.blinkAnim > 0) game.monster.blinkAnim -= dt;

  switch (game.phase) {
    case "calibrating":
      updateCalibration(dt, fs);
      break;
    case "playing":
      updatePlaying(dt, fs, ms);
      break;
    case "caught":
      game.freeze -= dt;
      if (game.freeze <= 0) resumeAfterCatch();
      break;
  }
}

// ---------- HUD ----------
function updateHUD(fs, ms) {
  const hearts = (n) => "♥".repeat(Math.max(0, n)) + "♡".repeat(CONFIG.LIVES - Math.max(0, n));
  $("livesPlayer").textContent = hearts(game.lives.player);
  $("livesMonster").textContent = hearts(game.lives.monster);

  const role = $("role");
  if (game.phase === "playing" || game.phase === "caught") {
    role.textContent =
      game.chaser === "player"
        ? "당신이 술래! 깜빡이지 말고 쫓아가세요"
        : "괴물이 술래! 도망치며 후~ 불어 눈을 말리세요";
    role.className = game.chaser;
  } else {
    role.textContent = "Don't Blink";
    role.className = "";
  }

  $("dryBar").style.width = `${game.dryness}%`;
  $("dryText").textContent = `${Math.round(game.dryness)}%`;
  $("dryBox").classList.toggle("inactive", game.chaser !== "monster");
  $("timer").textContent = fmtTime(game.time);

  // 입력 감지 표시 (조건 04)
  $("eyeIcon").textContent = !fs.ready ? "…" : !fs.faceFound ? "❓" : fs.eyesClosed ? "➖" : "👁️";
  $("micIcon").textContent = !ms.ready ? "…" : ms.isBlowing ? "🌬️" : ms.isVoice ? "🔊" : "🎤";
  $("notice").hidden = !(game.phase === "playing" && game.paused);
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
    "── 게임 ──",
    `단계        ${game.phase}`,
    `술래        ${game.chaser === "player" ? "나" : "괴물"}`,
    `눈 건조     ${f(game.dryness, 0)}%  (배율 ${f(game.dryFactor)})`,
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

showIntro();
requestAnimationFrame(loop);
