/**
 * YouTube API 키 매니저 (싱글톤)
 *
 * - YOUTUBE_API_KEY 환경변수에서 콤마 구분된 복수 키 파싱 (단일 키도 호환)
 * - quota 소진 시 다음 키로 자동 전환
 * - 태평양 시간(PT) 자정 기준 일일 리셋 (YouTube quota 리셋 시각)
 */
export class YoutubeApiKeyManager {
  private static instance: YoutubeApiKeyManager | null = null;

  private readonly keys: string[];
  private currentIndex: number;
  private exhaustedKeys: Set<number>;
  private lastResetDate: string;

  private constructor(keys: string[]) {
    this.keys = keys;
    this.currentIndex = 0;
    this.exhaustedKeys = new Set();
    this.lastResetDate = this.getPacificDateString();
  }

  static getInstance(): YoutubeApiKeyManager {
    if (!YoutubeApiKeyManager.instance) {
      const raw = process.env.YOUTUBE_API_KEY ?? "";
      const keys = raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      YoutubeApiKeyManager.instance = new YoutubeApiKeyManager(keys);
    }
    return YoutubeApiKeyManager.instance;
  }

  /** 테스트용 인스턴스 초기화 */
  static resetInstance(): void {
    YoutubeApiKeyManager.instance = null;
  }

  /** 사용 가능한 API 키 반환. 모두 소진 시 null */
  getKey(): string | null {
    this.resetIfNewDay();

    if (this.keys.length === 0) return null;
    if (this.exhaustedKeys.size >= this.keys.length) return null;

    // 현재 키가 소진됐으면 다음 사용 가능한 키 탐색
    if (this.exhaustedKeys.has(this.currentIndex)) {
      const nextIndex = this.findNextAvailableIndex();
      if (nextIndex === null) return null;
      this.currentIndex = nextIndex;
    }

    return this.keys[this.currentIndex];
  }

  /** 현재 키 quota 소진 처리 → 다음 키로 전환 */
  reportQuotaExhausted(): void {
    const maskedKey =
      this.keys[this.currentIndex]?.substring(0, 10) + "..." ?? "unknown";
    console.log(
      `[YoutubeApiKeyManager] API 키 quota 소진: ${maskedKey} (index: ${this.currentIndex})`,
    );

    this.exhaustedKeys.add(this.currentIndex);

    const nextIndex = this.findNextAvailableIndex();
    if (nextIndex !== null) {
      this.currentIndex = nextIndex;
      const nextMasked = this.keys[this.currentIndex].substring(0, 10) + "...";
      console.log(
        `[YoutubeApiKeyManager] 다음 키로 전환: ${nextMasked} (index: ${this.currentIndex})`,
      );
    } else {
      console.log(
        `[YoutubeApiKeyManager] 모든 API 키 소진 (${this.keys.length}개)`,
      );
    }
  }

  /** 태평양 시간 자정이 지났으면 소진 상태 초기화 */
  private resetIfNewDay(): void {
    const today = this.getPacificDateString();
    if (today !== this.lastResetDate) {
      console.log(
        `[YoutubeApiKeyManager] 일일 리셋 (${this.lastResetDate} → ${today})`,
      );
      this.exhaustedKeys.clear();
      this.currentIndex = 0;
      this.lastResetDate = today;
    }
  }

  private findNextAvailableIndex(): number | null {
    for (let offset = 1; offset < this.keys.length; offset++) {
      const idx = (this.currentIndex + offset) % this.keys.length;
      if (!this.exhaustedKeys.has(idx)) return idx;
    }
    return null;
  }

  /** 태평양 시간 기준 날짜 문자열 (YYYY-MM-DD) */
  private getPacificDateString(): string {
    return new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });
  }
}
