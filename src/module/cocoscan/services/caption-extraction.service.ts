import { getSubtitles } from "youtube-caption-extractor";

export class CaptionExtractionService {
  /** 서킷 브레이커: timedtext 429 발생 시 이번 배치에서 timedtext 스킵 */
  private timedtextBlocked = false;

  /** 배치 시작 시 서킷 브레이커 초기화 */
  resetCircuitBreaker(): void {
    this.timedtextBlocked = false;
  }

  /**
   * 유튜브 영상의 자막(캡션)을 가져옵니다.
   * 1차: youtube-caption-extractor (InnerTube WEB)
   * 2차: InnerTube /next → /get_transcript (timedtext 미사용)
   * 3차: ANDROID 클라이언트 (timedtext 사용, 서킷 브레이커 적용)
   * 4차: YouTube 페이지 스크래핑 (timedtext 사용)
   */
  async getVideoCaption(videoId: string): Promise<string | null> {
    console.log(`[Caption] === 자막 추출 시작: ${videoId} ===`);

    // 1차: youtube-caption-extractor (WEB)
    try {
      console.log("[Caption] 1차: youtube-caption-extractor (WEB)");
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
        `[Caption] WEB 실패: ${error instanceof Error ? error.message : error}`
      );
    }

    // 2차: /next → /get_transcript (timedtext 미사용, 429 우회)
    console.log("[Caption] 2차: /next → /get_transcript");
    const transcriptCaption = await this.getCaptionFromTranscript(videoId);
    if (transcriptCaption) return transcriptCaption;

    // 서킷 브레이커: 이전 영상에서 timedtext 429 발생 시 3~4차 스킵
    if (this.timedtextBlocked) {
      console.log(
        "[Caption] 3~4차 스킵: timedtext 서킷 브레이커 (이전 429 발생)"
      );
      console.log(`[Caption] === 모든 방법 실패: ${videoId} ===`);
      return null;
    }

    // 3차: ANDROID 클라이언트 (timedtext 사용)
    console.log("[Caption] 3차: ANDROID 클라이언트");
    const androidResult = await this.getCaptionFromAndroidClient(videoId);
    if (androidResult.caption) return androidResult.caption;

    if (androidResult.rateLimited) {
      // timedtext 429 → 서킷 브레이커 활성화 + 4차 스킵
      this.timedtextBlocked = true;
      console.log(
        "[Caption] timedtext 서킷 브레이커 활성화 — 이후 영상은 timedtext 스킵"
      );
    } else {
      // 4차: 페이지 스크래핑 (timedtext 사용)
      console.log("[Caption] 4차: 페이지 스크래핑");
      const pageCaption = await this.getCaptionFromPage(videoId);
      if (pageCaption) return pageCaption;
    }

    console.log(`[Caption] === 모든 방법 실패: ${videoId} ===`);
    return null;
  }

  /**
   * ANDROID 클라이언트로 InnerTube API를 호출하여 자막을 가져옵니다.
   */
  private async getCaptionFromAndroidClient(
    videoId: string
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
        }
      );

      if (!response.ok) {
        console.log(
          `[Caption:ANDROID] HTTP 실패: ${response.status} ${response.statusText}`
        );
        return { caption: null, rateLimited: false };
      }

      const data = await response.json();
      const status = data.playabilityStatus?.status;
      const reason = data.playabilityStatus?.reason;
      console.log(
        `[Caption:ANDROID] 상태: ${status}${reason ? ` (${reason})` : ""}`
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
    videoId: string
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
        }
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
        }
      );

      if (!transcriptResponse.ok) {
        const errorBody = await transcriptResponse
          .text()
          .catch(() => "(읽기 실패)");
        console.log(
          `[Caption:Transcript] /get_transcript 실패: ${transcriptResponse.status}`,
          errorBody.substring(0, 300)
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
        "engagement-panel-searchable-transcript"
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
        JSON.stringify(Object.keys(transcriptData)).substring(0, 200)
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
      `[Caption:Transcript] 추출 성공: ${caption.length}자 (${segments.length}개 세그먼트)`
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
        }
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
          `[Caption:Page] captionTracks 없음 (playerResponse=${hasPlayerResponse}, captions=${hasCaptions}, consent=${hasConsentForm})`
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
    label: string
  ): Promise<{ caption: string | null; rateLimited: boolean }> {
    if (tracks.length === 0) {
      console.log(`[Caption:${label}] 트랙 0개`);
      return { caption: null, rateLimited: false };
    }

    console.log(
      `[Caption:${label}] 트랙 ${tracks.length}개: ${tracks
        .map((t) => t.languageCode)
        .join(", ")}`
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
        100
      )}...`
    );
    const response = await this.fetchWithRetry(trackUrl);
    if (!response.ok) {
      const rateLimited = response.status === 429;
      console.log(
        `[Caption:${label}] XML 응답 실패: ${response.status} ${response.statusText}`
      );
      return { caption: null, rateLimited };
    }

    const text = await response.text();
    console.log(`[Caption:${label}] XML 응답 크기: ${text.length}자`);

    const caption = this.parseCaptionXml(text);
    if (!caption) {
      console.log(
        `[Caption:${label}] XML 파싱 실패. 응답 시작: ${text.substring(0, 200)}`
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
            t.replace(/<text[^>]*>/, "").replace(/<\/text>/, "")
          )
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
              s.replace(/<s[^>]*>/, "").replace(/<\/s>/, "")
            ).trim();
            if (text) segments.push(text);
          }
        } else {
          const text = this.decodeHtmlEntities(
            inner.replace(/<[^>]+>/g, "")
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
    timeoutMs = 30_000
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
      clearTimeout(timer)
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
    maxRetries = 5
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
          }/${maxRetries})`
        );
        await this.delay(waitSec * 1000);
      }
    }
    // 마지막 시도도 429면 그대로 반환
    return this.fetchWithTimeout(url, options);
  }
}
