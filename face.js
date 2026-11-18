// =====================================================
// face.js — 카메라, 깜빡임, 시선(고개+눈동자), 얼굴 거리
// MediaPipe Face Landmarker 사용
// =====================================================
import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { CONFIG } from "./config.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// 얼굴 랜드마크 번호
const NOSE = 1;
const CHEEK_A = 234;
const CHEEK_B = 454;
const FOREHEAD = 10;
const CHIN = 152;

export class FaceTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;

    this.eyesClosed = false;
    this.closedFrames = 0;

    // 보정값
    this.offsetX = 0;
    this.offsetY = 0;
    this.baseFaceWidth = 0.3;
    this.blinkBase = null; // 눈 뜬 상태의 eyeBlink 값 (보정으로 측정)
    this.lookDownBase = 0;
    this.calib = null;
    this.frameTimes = [];

    this.state = {
      ready: false,
      faceFound: false,
      blink: 0,
      blinkPeak: 0, // 최근 최고값 (깜빡임이 기준에 닿는지 확인용)
      blinkBase: null,
      blinkThreshold: CONFIG.BLINK_THRESHOLD,
      detectFps: 0, // 1초에 얼굴을 몇 번 분석하는지
      eyesClosed: false,
      blinkEvent: false, // 눈을 감는 순간 한 프레임만 true
      blinkCount: 0,
      lookDown: 0,
      headX: 0,
      headY: 0,
      gazeX: 0,
      gazeY: 0,
      rawX: 0,
      rawY: 0,
      moveX: 0, // -1 ~ 1, 화면 오른쪽이 +
      moveY: 0, // -1 ~ 1, 화면 아래쪽이 +
      faceWidth: 0,
      closeness: 1, // 1 = 보정 때 거리, 클수록 화면에 가까움
    };
  }

  async init() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });

    try {
      this.landmarker = await make("GPU");
    } catch (err) {
      console.warn("GPU 모드 실패, CPU 모드로 전환합니다.", err);
      this.landmarker = await make("CPU");
    }
    this.state.ready = true;
  }

  // ---------- 보정 ----------
  startCalibration() {
    this.calib = { x: [], y: [], w: [], b: [], ld: [] };
  }

  addCalibrationSample() {
    if (!this.calib || !this.state.faceFound) return;
    this.calib.x.push(this.state.rawX);
    this.calib.y.push(this.state.rawY);
    this.calib.w.push(this.state.faceWidth);
    this.calib.b.push(this.state.blink);
    this.calib.ld.push(this.state.lookDown);
  }

  finishCalibration() {
    // 중간값을 써서 보정 중 깜빡임이나 순간 움직임은 무시
    if (this.calib && this.calib.x.length > 0) {
      this.offsetX = median(this.calib.x);
      this.offsetY = median(this.calib.y);
      this.baseFaceWidth = median(this.calib.w) || this.baseFaceWidth;
      this.blinkBase = median(this.calib.b);
      this.lookDownBase = median(this.calib.ld);
      this.state.blinkBase = this.blinkBase;
    }
    this.calib = null;
  }

  // ---------- 매 프레임 ----------
  update() {
    const s = this.state;
    s.blinkEvent = false;

    if (!this.landmarker || this.video.readyState < 2) return s;

    // 새 카메라 프레임이 있을 때만 분석
    const vt = this.video.currentTime;
    if (vt === this.lastVideoTime) return s;
    this.lastVideoTime = vt;

    // 분석 속도 측정
    const now = performance.now();
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    s.detectFps = this.frameTimes.length;

    let res;
    try {
      res = this.landmarker.detectForVideo(this.video, performance.now());
    } catch (err) {
      return s;
    }

    if (!res.faceLandmarks?.length || !res.faceBlendshapes?.length) {
      s.faceFound = false;
      s.moveX = 0;
      s.moveY = 0;
      this.closedFrames = 0;
      return s;
    }
    s.faceFound = true;

    // 블렌드셰이프 값을 이름으로 꺼내기
    const bs = {};
    for (const c of res.faceBlendshapes[0].categories) bs[c.categoryName] = c.score;
    const g = (k) => bs[k] || 0;

    // ----- 깜빡임 -----
    const blink = (g("eyeBlinkLeft") + g("eyeBlinkRight")) / 2;
    const lookDown = (g("eyeLookDownLeft") + g("eyeLookDownRight")) / 2;
    const lookUp = (g("eyeLookUpLeft") + g("eyeLookUpRight")) / 2;
    // 사람마다 눈 뜬 상태의 값이 달라서, 보정값 기준으로 판정
    let threshold =
      this.blinkBase == null
        ? CONFIG.BLINK_THRESHOLD
        : Math.min(CONFIG.BLINK_MAX, Math.max(CONFIG.BLINK_MIN, this.blinkBase + CONFIG.BLINK_DELTA));
    threshold += CONFIG.BLINK_LOOKDOWN_COMP * Math.max(0, lookDown - this.lookDownBase);

    s.blink = blink;
    s.blinkPeak = Math.max(blink, s.blinkPeak * 0.97);
    s.blinkThreshold = threshold;
    s.lookDown = lookDown;

    if (this.eyesClosed) {
      if (blink < threshold - CONFIG.BLINK_HYSTERESIS) {
        this.eyesClosed = false;
        this.closedFrames = 0;
      }
    } else {
      this.closedFrames = blink > threshold ? this.closedFrames + 1 : 0;
      if (this.closedFrames >= CONFIG.BLINK_MIN_FRAMES) {
        this.eyesClosed = true;
        s.blinkEvent = true;
        s.blinkCount++;
      }
    }
    s.eyesClosed = this.eyesClosed;

    // ----- 고개 방향 -----
    const lm = res.faceLandmarks[0];
    const nose = lm[NOSE];
    const ca = lm[CHEEK_A];
    const cb = lm[CHEEK_B];
    const top = lm[FOREHEAD];
    const chin = lm[CHIN];

    const faceW = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1e-6;
    const faceH = Math.hypot(chin.x - top.x, chin.y - top.y) || 1e-6;
    const yaw = (nose.x - (ca.x + cb.x) / 2) / faceW; // 카메라 원본 기준

    // 위아래(pitch): 이마→코 거리와 코→턱 거리의 비율로 계산
    // 고개를 숙이면 코가 턱 쪽으로 내려가 보여서 비율이 크게 변함 (예전 방식보다 3배쯤 민감)
    const ux = (chin.x - top.x) / faceH;
    const uy = (chin.y - top.y) / faceH;
    const dUp = (nose.x - top.x) * ux + (nose.y - top.y) * uy;
    const dDown = (chin.x - nose.x) * ux + (chin.y - nose.y) * uy;
    const pitch = dUp > 0 && dDown > 0 ? Math.log(dUp / dDown) : 0;

    // 카메라 원본은 좌우가 반대이므로 뒤집어서 '화면 오른쪽 = +'로 맞춤
    s.headX = -yaw * (CONFIG.INVERT_HEAD_X ? -1 : 1);
    s.headY = pitch * (CONFIG.INVERT_HEAD_Y ? -1 : 1);

    // ----- 눈동자 방향 -----
    let gx =
      (g("eyeLookOutRight") + g("eyeLookInLeft") - (g("eyeLookInRight") + g("eyeLookOutLeft"))) / 2;
    if (CONFIG.INVERT_GAZE_X) gx = -gx;
    s.gazeX = gx;
    s.gazeY = lookDown - lookUp;

    // ----- 합치기 -----
    s.rawX = s.headX * CONFIG.HEAD_WEIGHT_X + s.gazeX * CONFIG.GAZE_WEIGHT_X;
    s.rawY = s.headY * CONFIG.HEAD_WEIGHT_Y + s.gazeY * CONFIG.GAZE_WEIGHT_Y;

    s.faceWidth = faceW;
    s.closeness = faceW / this.baseFaceWidth;

    // ----- 이동 벡터 (조이스틱 방식) -----
    let x = s.rawX - this.offsetX;
    let y = s.rawY - this.offsetY;
    if (this.eyesClosed) {
      x = 0;
      y = 0;
    }

    const mag = Math.hypot(x, y);
    let mx = 0;
    let my = 0;
    if (mag > CONFIG.DEAD_ZONE) {
      const scaled = Math.min(1, (mag - CONFIG.DEAD_ZONE) / (1 - CONFIG.DEAD_ZONE));
      mx = (x / mag) * scaled;
      my = (y / mag) * scaled;
    }

    const a = CONFIG.MOVE_SMOOTHING;
    s.moveX += (mx - s.moveX) * a;
    s.moveY += (my - s.moveY) * a;

    return s;
  }
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
