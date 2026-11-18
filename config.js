// =====================================================
// Don't Blink 설정값
// 테스트하면서 숫자만 바꿔서 조정하세요.
// =====================================================
export const CONFIG = {
  // ---------- 화면 ----------
  WIDTH: 960,
  HEIGHT: 540,

  // ---------- 캐릭터 ----------
  PLAYER_RADIUS: 18,
  MONSTER_RADIUS: 30,
  PLAYER_SPEED: 210,          // 플레이어 최고 속도 (px/초)
  MONSTER_CHASE_SPEED: 135,   // 괴물이 술래일 때 쫓는 속도
  MONSTER_FLEE_SPEED: 165,    // 괴물이 도망칠 때 속도
  MONSTER_RELAX_DIST: 320,    // 플레이어가 이보다 멀면 괴물이 천천히 도망침

  // ---------- 규칙 ----------
  LIVES: 3,
  SWAP_GRACE: 1.0,            // 역할 교체 직후 잡기 무효 시간 (초)
  CAUGHT_FREEZE: 2.0,         // 잡힌 뒤 멈추는 시간 (초)

  // ---------- 깜빡임 ----------
  // 기준값 = (보정 때 측정한 '눈 뜬 상태 값') + BLINK_DELTA
  BLINK_DELTA: 0.2,           // 작을수록 민감 (깜빡임이 안 잡히면 줄이기)
  BLINK_MIN: 0.25,            // 기준값 하한
  BLINK_MAX: 0.6,             // 기준값 상한
  BLINK_THRESHOLD: 0.4,       // 보정 전에 쓰는 기본 기준값
  BLINK_LOOKDOWN_COMP: 0.15,  // 아래를 볼 때 기준값을 이만큼 올림 (오감지 방지)
  BLINK_HYSTERESIS: 0.1,      // 다시 '뜸'으로 판정할 때 여유
  BLINK_MIN_FRAMES: 1,        // 연속 몇 프레임 감아야 깜빡임으로 인정할지

  // ---------- 시선 이동 ----------
  HEAD_WEIGHT_X: 5.0,         // 고개 좌우 회전의 영향
  GAZE_WEIGHT_X: 1.5,         // 눈동자 좌우의 영향
  HEAD_WEIGHT_Y: 3.0,         // 고개 위아래의 영향 (위아래가 둔하면 올리기)
  GAZE_WEIGHT_Y: 0.2,         // 눈동자 위아래의 영향
                              // (고개를 숙여도 눈은 화면을 보려고 위로 올라가서 고개 움직임을 상쇄하므로 낮게)
  DEAD_ZONE: 0.12,            // 가운데 무반응 구간
  MOVE_SMOOTHING: 0.25,       // 0~1, 작을수록 부드럽지만 느리게 반응
  INVERT_HEAD_X: false,       // 고개를 오른쪽으로 돌렸는데 왼쪽으로 가면 true
  INVERT_GAZE_X: false,       // 눈만 오른쪽으로 봤는데 왼쪽으로 가면 true
  INVERT_HEAD_Y: false,       // 고개를 숙였는데 위로 가면 true

  // ---------- 입김 ----------
  BREATH_MIN_VOLUME: 0.012,   // 최소 볼륨 (보정 단계에서 주변 소음에 맞춰 올라갈 수 있음)
  NOISE_MULTIPLIER: 1.8,      // 기준 볼륨 = 주변 소음 × 이 값
  BREATH_MIN_FLATNESS: 0.16,  // 평탄도가 이 이상이면 입김
  VOICE_MAX_FLATNESS: 0.1,    // 평탄도가 이 이하면 목소리
  BREATH_MIN_DURATION: 0.15,  // 입김이 이만큼 지속돼야 인정 (초)
  FLATNESS_MIN_HZ: 100,
  FLATNESS_MAX_HZ: 8000,

  // ---------- 괴물 눈 건조 게이지 ----------
  DRY_RATE: 35,               // 입김을 불 때 초당 증가량 (%)
  DRY_DECAY: 10,              // 입김을 멈췄을 때 초당 감소량 (%)
  DRY_NEAR_DIST: 120,         // 이 거리 이내면 효과 최대
  DRY_FAR_DIST: 500,          // 이 거리 이상이면 효과 최소
  DRY_MIN_FACTOR: 0.2,        // 멀 때 배율
  DRY_MAX_FACTOR: 1.6,        // 가까울 때 배율

  // ---------- 시작 전 기준점 측정 ----------
  CALIBRATION_TIME: 3,        // 초
};
