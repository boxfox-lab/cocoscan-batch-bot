import { getSubtitles } from "youtube-caption-extractor";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, access } from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";

const execFileAsync = promisify(execFile);

export class CaptionExtractionService {
  /** 서킷 브레이커: timedtext 429 발생 시 이번 배치에서 timedtext 스킵 */
  private timedtextBlocked = false;

  /** yt-dlp 설치 여부 (1회 체크 후 캐싱) */
  private ytdlpAvailable: boolean | null = null;

  /** Gemini AI 클라이언트 (lazy init) */
  private genAI: GoogleGenerativeAI | null = null;

  /** 배치 시작 시 서킷 브레이커 초기화 */
  resetCircuitBreaker(): void {
    this.timedtextBlocked = false;
  }

  /**
   * 유튜브 영상의 자막(캡션)을 가져옵니다.
   * 1차: yt-dlp 자막 (자체 UA/쿠키로 429 우회 가능)
   * 2차: youtube-caption-extractor (InnerTube WEB)
   * 3차: InnerTube /next → /get_transcript (timedtext 미사용)
   * 4차: ANDROID 클라이언트 (timedtext 사용, 서킷 브레이커 적용)
   * 5차: YouTube 페이지 스크래핑 (timedtext 사용)
   * 6차: Gemini Audio STT (자막 API 완전 우회, 최종 수단)
   */
  async getVideoCaption(videoId: string): Promise<string | null> {
    console.log(`[Caption] === 자막 추출 시작: ${videoId} ===`);

    // 1차: yt-dlp 자막
    try {
      console.log("[Caption] 1차: yt-dlp 자막");
      const ytdlpCaption = await this.getCaptionFromYtdlp(videoId);
      if (ytdlpCaption) return ytdlpCaption;
    } catch (error) {
      console.log(
        `[Caption] yt-dlp 실패: ${error instanceof Error ? error.message : error}`,
      );
    }

    // 2차: youtube-caption-extractor (WEB)
    try {
      console.log("[Caption] 2차: youtube-caption-extractor (WEB)");
      const koCaption = await getSubtitles({ videoID: videoId, lang: "ko" });
      if (koCaption && koCaption.length > 0) {
        console.log(`[Caption] WEB ko 성공: ${koCaption.length}개 세그먼트`);
        return koCaption.map((c: any) => c.text || c).join(" ");
      }
      console.log(`[Caption] WEB ko 결과: ${koCaption?.length ?? 0}개`);

      const enCaption = await getSubtitles({ videoID: videoId, lang: "en" });
      if (enCaption && enCaption.length > 0) {
        console.log(`[Caption] WEB en 성공: ${enCaption.length}개 세그먼트`);
        return enCaption.map((c: any) => c.text || c).join(" ");
      }
      console.log(`[Caption] WEB en 결과: ${enCaption?.length ?? 0}개`);
    } catch (error) {
      console.log(
        `[Caption] WEB 실패: ${error instanceof Error ? error.message : error}`,
      );
    }

    // 3차: /next → /get_transcript (timedtext 미사용, 429 우회)
    console.log("[Caption] 3차: /next → /get_transcript");
    const transcriptCaption = await this.getCaptionFromTranscript(videoId);
    if (transcriptCaption) return transcriptCaption;

    // 서킷 브레이커: 이전 영상에서 timedtext 429 발생 시 4~5차 스킵
    if (this.timedtextBlocked) {
      console.log(
        "[Caption] 4~5차 스킵: timedtext 서킷 브레이커 (이전 429 발생)",
      );
    } else {
      // 4차: ANDROID 클라이언트 (timedtext 사용)
      console.log("[Caption] 4차: ANDROID 클라이언트");
      const androidResult = await this.getCaptionFromAndroidClient(videoId);
      if (androidResult.caption) return androidResult.caption;

      if (androidResult.rateLimited) {
        this.timedtextBlocked = true;
        console.log(
          "[Caption] timedtext 서킷 브레이커 활성화 — 이후 영상은 timedtext 스킵",
        );
      } else {
        // 5차: 페이지 스크래핑 (timedtext 사용)
        console.log("[Caption] 5차: 페이지 스크래핑");
        const pageCaption = await this.getCaptionFromPage(videoId);
        if (pageCaption) return pageCaption;
      }
    }

    // 6차: Gemini Audio STT (최종 수단, API 비용 발생)
    try {
      console.log("[Caption] 6차: Gemini Audio STT");
      const geminiCaption = await this.getCaptionFromGeminiStt(videoId);
      if (geminiCaption) return geminiCaption;
    } catch (error) {
      console.log(
        `[Caption] Gemini STT 실패: ${error instanceof Error ? error.message : error}`,
      );
    }

    console.log(`[Caption] === 모든 방법 실패: ${videoId} ===`);
    return null;
  }

  /**
   * ANDROID 클라이언트로 InnerTube API를 호출하여 자막을 가져옵니다.
   */
  private async getCaptionFromAndroidClient(
    videoId: string,
  ): Promise<{ caption: string | null; rateLimited: boolean }> {
    try {
      const response = await this.fetchWithTimeout(
        "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: "ANDROID",
                clientVersion: "19.09.37",
                androidSdkVersion: 30,
                hl: "ko",
                gl: "KR",
              },
            },
          }),
        },
      );

      if (!response.ok) {
        console.log(
          `[Caption:ANDROID] HTTP 실패: ${response.status} ${response.statusText}`,
        );
        return { caption: null, rateLimited: false };
      }

      const data = await response.json();
      const status = data.playabilityStatus?.status;
      const reason = data.playabilityStatus?.reason;
      console.log(
        `[Caption:ANDROID] 상태: ${status}${reason ? ` (${reason})` : ""}`,
      );

      if (status !== "OK") return { caption: null, rateLimited: false };

      const tracks =
        data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const result = await this.fetchCaptionFromTracks(tracks || [], "ANDROID");
      return {
        caption: result.caption,
        rateLimited: result.rateLimited,
      };
    } catch (error) {
      console.error(`[Caption:ANDROID] 에러:`, error);
      return { caption: null, rateLimited: false };
    }
  }

  /**
   * InnerTube 세션 데이터 생성 (라이브러리 동일 방식)
   */
  private generateInnerTubeSession() {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let visitorData = "";
    for (let i = 0; i < 11; i++) {
      visitorData += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const key = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
    const clientVersion = "2.20250222.10.00";

    return {
      key,
      visitorData,
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "X-Youtube-Client-Version": clientVersion,
        "X-Youtube-Client-Name": "1",
        "X-Goog-Visitor-Id": visitorData,
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com/",
      },
      payload: {
        context: {
          client: {
            hl: "ko",
            gl: "KR",
            clientName: "WEB",
            clientVersion,
            visitorData,
          },
          user: { enableSafetyMode: false },
          request: { useSsl: true },
        },
        visitorData,
      },
    };
  }

  /**
   * InnerTube /next → /get_transcript 방식으로 자막을 가져옵니다.
   * timedtext URL을 거치지 않아 429 rate limit을 우회합니다.
   */
  private async getCaptionFromTranscript(
    videoId: string,
  ): Promise<string | null> {
    try {
      const session = this.generateInnerTubeSession();
      const baseUrl = "https://www.youtube.com/youtubei/v1";

      // 1. /next로 engagement panel에서 transcript 토큰 추출
      const nextResponse = await this.fetchWithTimeout(
        `${baseUrl}/next?key=${session.key}`,
        {
          method: "POST",
          headers: session.headers,
          body: JSON.stringify({
            ...session.payload,
            videoId,
          }),
        },
      );

      if (!nextResponse.ok) {
        console.log(`[Caption:Transcript] /next 실패: ${nextResponse.status}`);
        return null;
      }

      const nextData = await nextResponse.json();
      const panels = nextData.engagementPanels || [];
      console.log(`[Caption:Transcript] engagement panels: ${panels.length}개`);

      // transcript 패널에서 continuation 토큰 추출 (4가지 방법)
      const token = this.extractTranscriptToken(panels);

      if (!token) {
        console.log("[Caption:Transcript] 토큰 추출 실패");
        return null;
      }

      // 2. /get_transcript로 자막 텍스트 직접 추출
      const transcriptResponse = await this.fetchWithTimeout(
        `${baseUrl}/get_transcript?key=${session.key}`,
        {
          method: "POST",
          headers: session.headers,
          body: JSON.stringify({
            context: session.payload.context,
            params: token,
          }),
        },
      );

      if (!transcriptResponse.ok) {
        const errorBody = await transcriptResponse
          .text()
          .catch(() => "(읽기 실패)");
        console.log(
          `[Caption:Transcript] /get_transcript 실패: ${transcriptResponse.status}`,
          errorBody.substring(0, 300),
        );
        return null;
      }

      const transcriptData = await transcriptResponse.json();
      return this.parseTranscriptSegments(transcriptData);
    } catch (error) {
      console.error("[Caption:Transcript] 에러:", error);
      return null;
    }
  }

  /**
   * engagement panels에서 transcript continuation 토큰을 추출합니다.
   */
  private extractTranscriptToken(panels: any[]): string | null {
    const transcriptPanel = panels.find(
      (p: any) =>
        p?.engagementPanelSectionListRenderer?.panelIdentifier ===
        "engagement-panel-searchable-transcript",
    );

    if (!transcriptPanel) {
      console.log("[Caption:Transcript] transcript 패널 없음");
      return null;
    }

    const content = transcriptPanel.engagementPanelSectionListRenderer?.content;

    // Method 1: continuationCommand.token
    const ci1 = content?.continuationItemRenderer;
    if (ci1?.continuationEndpoint?.continuationCommand?.token) {
      console.log("[Caption:Transcript] 토큰 방법 1: continuationCommand");
      return ci1.continuationEndpoint.continuationCommand.token;
    }

    // Method 2: getTranscriptEndpoint.params
    if (ci1?.continuationEndpoint?.getTranscriptEndpoint?.params) {
      console.log("[Caption:Transcript] 토큰 방법 2: getTranscriptEndpoint");
      return ci1.continuationEndpoint.getTranscriptEndpoint.params;
    }

    // Method 3: sectionListRenderer
    if (content?.sectionListRenderer?.contents?.[0]) {
      const ci2 =
        content.sectionListRenderer.contents[0].continuationItemRenderer;
      if (ci2?.continuationEndpoint?.continuationCommand?.token) {
        console.log("[Caption:Transcript] 토큰 방법 3: sectionListRenderer");
        return ci2.continuationEndpoint.continuationCommand.token;
      }
    }

    // Method 4: transcriptRenderer footer language menu
    if (content?.sectionListRenderer?.contents) {
      for (const item of content.sectionListRenderer.contents) {
        const menuItems =
          item?.transcriptRenderer?.footer?.transcriptFooterRenderer
            ?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems;
        if (menuItems) {
          const selected =
            menuItems.find((m: any) => m?.selected === true) || menuItems[0];
          if (selected?.continuation?.reloadContinuationData?.continuation) {
            console.log("[Caption:Transcript] 토큰 방법 4: languageMenu");
            return selected.continuation.reloadContinuationData.continuation;
          }
        }
      }
    }

    return null;
  }

  /**
   * /get_transcript 응답에서 세그먼트 텍스트를 추출합니다.
   */
  private parseTranscriptSegments(transcriptData: any): string | null {
    const initialSegments =
      transcriptData?.actions?.[0]?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
        ?.transcriptSegmentListRenderer?.initialSegments;

    if (!initialSegments || !Array.isArray(initialSegments)) {
      console.log(
        "[Caption:Transcript] initialSegments 없음. 응답 키:",
        JSON.stringify(Object.keys(transcriptData)).substring(0, 200),
      );
      return null;
    }

    const segments: string[] = [];
    for (const seg of initialSegments) {
      const renderer = seg.transcriptSegmentRenderer;
      if (!renderer) continue;

      let text = "";
      if (renderer.snippet?.simpleText) {
        text = renderer.snippet.simpleText;
      } else if (renderer.snippet?.runs) {
        text = renderer.snippet.runs.map((r: any) => r.text).join("");
      }
      if (text.trim()) segments.push(text.trim());
    }

    if (segments.length === 0) {
      console.log("[Caption:Transcript] 세그먼트 0개");
      return null;
    }

    const caption = segments.join(" ");
    console.log(
      `[Caption:Transcript] 추출 성공: ${caption.length}자 (${segments.length}개 세그먼트)`,
    );
    return caption;
  }

  /**
   * YouTube 페이지에서 직접 자막 URL을 추출하여 자막을 가져옵니다.
   */
  private async getCaptionFromPage(videoId: string): Promise<string | null> {
    try {
      const response = await this.fetchWithTimeout(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          },
        },
      );

      if (!response.ok) {
        console.log(`[Caption:Page] HTTP 실패: ${response.status}`);
        return null;
      }

      const html = await response.text();
      console.log(`[Caption:Page] HTML 크기: ${html.length}자`);

      const match = html.match(/"captionTracks":(\[.*?\])/);
      if (!match) {
        const hasPlayerResponse = html.includes("playerResponse");
        const hasCaptions = html.includes("captions");
        const hasConsentForm = html.includes("consent.youtube.com");
        console.log(
          `[Caption:Page] captionTracks 없음 (playerResponse=${hasPlayerResponse}, captions=${hasCaptions}, consent=${hasConsentForm})`,
        );
        return null;
      }

      const tracks = JSON.parse(match[1].replace(/\\u0026/g, "&"));
      const result = await this.fetchCaptionFromTracks(tracks, "Page");
      return result.caption;
    } catch (error) {
      console.error("[Caption:Page] 에러:", error);
      return null;
    }
  }

  /**
   * 자막 트랙 목록에서 한국어 우선으로 자막 텍스트를 가져옵니다.
   */
  private async fetchCaptionFromTracks(
    tracks: Array<{ languageCode: string; baseUrl?: string }>,
    label: string,
  ): Promise<{ caption: string | null; rateLimited: boolean }> {
    if (tracks.length === 0) {
      console.log(`[Caption:${label}] 트랙 0개`);
      return { caption: null, rateLimited: false };
    }

    console.log(
      `[Caption:${label}] 트랙 ${tracks.length}개: ${tracks
        .map((t) => t.languageCode)
        .join(", ")}`,
    );

    const koTrack = tracks.find((t) => t.languageCode === "ko");
    const track = koTrack || tracks[0];
    if (!track?.baseUrl) {
      console.log(`[Caption:${label}] baseUrl 없음`);
      return { caption: null, rateLimited: false };
    }

    // fmt=srv1로 format 1 (단순 <text> 태그) 요청
    const trackUrl = track.baseUrl.includes("fmt=")
      ? track.baseUrl
      : `${track.baseUrl}&fmt=srv1`;
    console.log(
      `[Caption:${label}] ${track.languageCode} 트랙 요청: ${trackUrl.substring(
        0,
        100,
      )}...`,
    );
    const response = await this.fetchWithRetry(trackUrl);
    if (!response.ok) {
      const rateLimited = response.status === 429;
      console.log(
        `[Caption:${label}] XML 응답 실패: ${response.status} ${response.statusText}`,
      );
      return { caption: null, rateLimited };
    }

    const text = await response.text();
    console.log(`[Caption:${label}] XML 응답 크기: ${text.length}자`);

    const caption = this.parseCaptionXml(text);
    if (!caption) {
      console.log(
        `[Caption:${label}] XML 파싱 실패. 응답 시작: ${text.substring(0, 200)}`,
      );
    } else {
      console.log(`[Caption:${label}] 캡션 추출 성공: ${caption.length}자`);
    }
    return { caption, rateLimited: false };
  }

  /**
   * XML 자막 텍스트를 파싱하여 문자열로 반환합니다.
   * format 1 (<text> 태그) 과 format 3 (<p> 태그) 모두 지원합니다.
   */
  private parseCaptionXml(xml: string): string | null {
    // format 1: <text> 태그
    const texts = xml.match(/<text[^>]*>(.*?)<\/text>/g);
    if (texts) {
      return texts
        .map((t: string) =>
          this.decodeHtmlEntities(
            t.replace(/<text[^>]*>/, "").replace(/<\/text>/, ""),
          ),
        )
        .join(" ");
    }

    // format 3: <p> 태그 안에 <s> 태그 또는 직접 텍스트
    const paragraphs = xml.match(/<p[^>]*>([\s\S]*?)<\/p>/g);
    if (paragraphs) {
      const segments: string[] = [];
      for (const p of paragraphs) {
        const inner = p.replace(/<p[^>]*>/, "").replace(/<\/p>/, "");
        const sTags = inner.match(/<s[^>]*>(.*?)<\/s>/g);
        if (sTags) {
          for (const s of sTags) {
            const text = this.decodeHtmlEntities(
              s.replace(/<s[^>]*>/, "").replace(/<\/s>/, ""),
            ).trim();
            if (text) segments.push(text);
          }
        } else {
          const text = this.decodeHtmlEntities(
            inner.replace(/<[^>]+>/g, ""),
          ).trim();
          if (text) segments.push(text);
        }
      }
      if (segments.length > 0) return segments.join(" ");
    }

    return null;
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 30_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 429 대응: 재시도 + 지수 백오프
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    maxRetries = 5,
  ): Promise<Response> {
    const waitSeconds = [5, 15, 30, 45, 60];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.fetchWithTimeout(url, options);
      if (response.status !== 429) return response;

      if (attempt < maxRetries) {
        const waitSec = waitSeconds[attempt] ?? 60;
        console.log(
          `[Caption] 429 rate limit, ${waitSec}초 후 재시도 (${
            attempt + 1
          }/${maxRetries})`,
        );
        await this.delay(waitSec * 1000);
      }
    }
    // 마지막 시도도 429면 그대로 반환
    return this.fetchWithTimeout(url, options);
  }

  /**
   * yt-dlp CLI 설치 여부를 체크합니다 (결과 캐싱).
   */
  private async checkYtdlpAvailable(): Promise<boolean> {
    if (this.ytdlpAvailable !== null) return this.ytdlpAvailable;

    try {
      await execFileAsync("yt-dlp", ["--version"]);
      this.ytdlpAvailable = true;
      console.log("[Caption:yt-dlp] yt-dlp 사용 가능");
    } catch {
      this.ytdlpAvailable = false;
      console.log("[Caption:yt-dlp] yt-dlp 미설치 — 스킵");
    }
    return this.ytdlpAvailable;
  }

  /**
   * yt-dlp CLI로 자막 파일을 다운로드하여 텍스트를 추출합니다.
   */
  private async getCaptionFromYtdlp(videoId: string): Promise<string | null> {
    if (!(await this.checkYtdlpAvailable())) return null;

    const timestamp = Date.now();
    const basePath = `/tmp/cocoscan_caption_${videoId}_${timestamp}`;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      await execFileAsync(
        "yt-dlp",
        [
          "--write-sub",
          "--write-auto-sub",
          "--sub-lang",
          "ko,en",
          "--skip-download",
          "--sub-format",
          "srv1",
          "-o",
          basePath,
          url,
        ],
        { timeout: 60_000 },
      );

      const caption = await this.readYtdlpSubtitleFile(basePath, videoId);
      return caption;
    } catch (error) {
      console.log(
        `[Caption:yt-dlp] 에러: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    } finally {
      await this.cleanupTempFiles(basePath, videoId);
    }
  }

  /**
   * yt-dlp가 다운로드한 자막 파일을 찾아 파싱합니다.
   * srv1 → parseCaptionXml, vtt → parseVttContent
   */
  private async readYtdlpSubtitleFile(
    basePath: string,
    videoId: string,
  ): Promise<string | null> {
    const langPriority = ["ko", "en"];
    const formatPriority = ["srv1", "vtt"];

    for (const lang of langPriority) {
      for (const fmt of formatPriority) {
        const filePath = `${basePath}.${lang}.${fmt}`;
        try {
          await access(filePath);
          const content = await readFile(filePath, "utf-8");

          if (!content.trim()) continue;

          const caption =
            fmt === "srv1"
              ? this.parseCaptionXml(content)
              : this.parseVttContent(content);

          if (caption) {
            console.log(
              `[Caption:yt-dlp] ${lang}.${fmt} 성공: ${caption.length}자`,
            );
            return caption;
          }
        } catch {
          // 파일 없음 → 다음 시도
        }
      }
    }

    console.log(`[Caption:yt-dlp] 자막 파일 없음: ${videoId}`);
    return null;
  }

  /**
   * WebVTT 형식의 자막을 파싱합니다.
   */
  private parseVttContent(vtt: string): string | null {
    const lines = vtt.split("\n");
    const segments: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();

      // 헤더, 빈 줄, 타임스탬프 라인 스킵
      if (!trimmed) continue;
      if (trimmed === "WEBVTT") continue;
      if (trimmed.startsWith("Kind:")) continue;
      if (trimmed.startsWith("Language:")) continue;
      if (trimmed.startsWith("NOTE")) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (/-->/.test(trimmed)) continue;

      // HTML 태그 제거 + 디코딩
      const text = this.decodeHtmlEntities(
        trimmed.replace(/<[^>]+>/g, ""),
      ).trim();

      if (text && !seen.has(text)) {
        seen.add(text);
        segments.push(text);
      }
    }

    if (segments.length === 0) return null;
    return segments.join(" ");
  }

  /**
   * Gemini Audio STT로 오디오를 변환하여 자막을 추출합니다 (최종 수단).
   */
  private async getCaptionFromGeminiStt(
    videoId: string,
  ): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log("[Caption:Gemini] GEMINI_API_KEY 미설정 — 스킵");
      return null;
    }

    if (!(await this.checkYtdlpAvailable())) {
      console.log("[Caption:Gemini] yt-dlp 미설치 — 오디오 다운로드 불가");
      return null;
    }

    const timestamp = Date.now();
    const audioPath = `/tmp/cocoscan_audio_${videoId}_${timestamp}.mp3`;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      // 오디오 다운로드 (최저 품질)
      console.log("[Caption:Gemini] 오디오 다운로드 중...");
      await execFileAsync(
        "yt-dlp",
        [
          "-x",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "9",
          "-o",
          audioPath,
          url,
        ],
        { timeout: 120_000 },
      );

      // 파일 크기 체크 (20MB 초과 시 스킵)
      const { stat } = await import("fs/promises");
      const fileStat = await stat(audioPath);
      const sizeMb = fileStat.size / (1024 * 1024);
      console.log(`[Caption:Gemini] 오디오 크기: ${sizeMb.toFixed(1)}MB`);

      if (sizeMb > 20) {
        console.log("[Caption:Gemini] 20MB 초과 — 스킵");
        return null;
      }

      // Gemini STT 호출
      if (!this.genAI) {
        this.genAI = new GoogleGenerativeAI(apiKey);
      }

      const audioData = await readFile(audioPath);
      const base64Audio = audioData.toString("base64");

      const model = this.genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
      });

      console.log("[Caption:Gemini] STT 요청 중...");
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: "audio/mp3",
            data: base64Audio,
          },
        },
        {
          text: "이 오디오의 내용을 그대로 텍스트로 변환해주세요. 말한 내용만 텍스트로 출력하고, 다른 설명이나 주석은 추가하지 마세요.",
        },
      ]);

      const caption = result.response.text()?.trim();
      if (!caption) {
        console.log("[Caption:Gemini] 빈 응답");
        return null;
      }

      console.log(`[Caption:Gemini] STT 성공: ${caption.length}자`);
      return caption;
    } catch (error) {
      console.log(
        `[Caption:Gemini] 에러: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    } finally {
      try {
        await unlink(audioPath);
      } catch {
        // 정리 실패 무시
      }
    }
  }

  /**
   * yt-dlp가 생성한 임시 자막 파일들을 정리합니다.
   */
  private async cleanupTempFiles(
    basePath: string,
    videoId: string,
  ): Promise<void> {
    const extensions = [
      "ko.srv1",
      "en.srv1",
      "ko.vtt",
      "en.vtt",
      "ko.srt",
      "en.srt",
    ];
    for (const ext of extensions) {
      try {
        await unlink(`${basePath}.${ext}`);
      } catch {
        // 파일 없음 무시
      }
    }
    // yt-dlp가 생성할 수 있는 메타 파일 정리
    try {
      await unlink(`${basePath}.temp`);
    } catch {
      // 무시
    }
  }
}
