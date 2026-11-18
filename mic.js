// =====================================================
// mic.js — 마이크, 입김/목소리 판정
// 볼륨(RMS) + 스펙트럼 평탄도 + 지속 시간
// =====================================================
import { CONFIG } from "./config.js";

export class MicTracker {
  constructor() {
    this.ready = false;
    this.volThreshold = CONFIG.BREATH_MIN_VOLUME;
    this.breathTime = 0;
    this.voiceTime = 0;
    this.voiceHold = 0;
    this.calib = null;

    this.state = {
      ready: false,
      volume: 0,
      flatness: 0,
      threshold: this.volThreshold,
      isBlowing: false,
      isVoice: false,
    };
  }

  async init() {
    // 오디오 컨텍스트는 클릭 직후 바로 만들어야 브라우저가 막지 않음
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false, // 켜져 있으면 입김을 잡음으로 지워버림
        autoGainControl: false,
      },
      video: false,
    });

    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.2;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);

    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);

    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.lo = Math.max(1, Math.round(CONFIG.FLATNESS_MIN_HZ / binHz));
    this.hi = Math.min(this.freqBuf.length - 1, Math.round(CONFIG.FLATNESS_MAX_HZ / binHz));

    this.ready = true;
    this.state.ready = true;
  }

  // ---------- 보정: 주변 소음 측정 ----------
  startCalibration() {
    this.calib = [];
  }

  addCalibrationSample() {
    if (this.calib && this.ready) this.calib.push(this.state.volume);
  }

  finishCalibration() {
    if (this.calib && this.calib.length > 0) {
      const noise = this.calib.reduce((s, v) => s + v, 0) / this.calib.length;
      this.volThreshold = Math.max(CONFIG.BREATH_MIN_VOLUME, noise * CONFIG.NOISE_MULTIPLIER);
    }
    this.calib = null;
  }

  // 보정 화면 파형 그리기용 (최근 프레임의 소리 모양)
  getWaveform() {
    return this.ready ? this.timeBuf : null;
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    const s = this.state;
    if (!this.ready) return s;

    // 볼륨 (RMS)
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sum / this.timeBuf.length);

    // 스펙트럼 평탄도 = 기하평균 / 산술평균
    // 입김(잡음)은 높고, 목소리(음높이 있음)는 낮음
    this.analyser.getFloatFrequencyData(this.freqBuf);
    let logSum = 0;
    let linSum = 0;
    let n = 0;
    for (let i = this.lo; i <= this.hi; i++) {
      const db = this.freqBuf[i];
      // 같은 작은 값을 양쪽에 더해야 결과가 항상 0~1 사이 (조용할 때 값이 튀지 않음)
      const p = (Number.isFinite(db) ? Math.pow(10, db / 10) : 0) + 1e-12;
      logSum += Math.log(p);
      linSum += p;
      n++;
    }
    const flat = linSum > 0 && n > 0 ? Math.exp(logSum / n) / (linSum / n) : 0;

    // 흔들림 줄이기
    s.volume += (rms - s.volume) * 0.5;
    s.flatness += (flat - s.flatness) * 0.3;
    s.threshold = this.volThreshold;

    const loud = s.volume > this.volThreshold;
    const breathy = loud && s.flatness >= CONFIG.BREATH_MIN_FLATNESS;
    const voicey = loud && s.flatness <= CONFIG.VOICE_MAX_FLATNESS;

    // 한두 프레임 튀는 값에 끊기지 않도록 천천히 줄어들게
    const maxT = CONFIG.BREATH_MIN_DURATION + 0.2;
    this.breathTime = breathy
      ? Math.min(maxT, this.breathTime + dt)
      : Math.max(0, this.breathTime - dt * 3);
    s.isBlowing = this.breathTime >= CONFIG.BREATH_MIN_DURATION;

    this.voiceTime = voicey ? Math.min(0.5, this.voiceTime + dt) : Math.max(0, this.voiceTime - dt * 3);
    if (this.voiceTime >= 0.25) this.voiceHold = 1.0; // 말풍선이 1초 정도 보이도록
    this.voiceHold = Math.max(0, this.voiceHold - dt);
    s.isVoice = this.voiceHold > 0 && !s.isBlowing;

    return s;
  }
}
