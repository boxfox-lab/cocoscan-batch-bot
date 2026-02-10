import { getSubtitles } from "youtube-caption-extractor";
import { Repository } from "typeorm";
import { AppDataSource } from "../../database/data-source";
import {
  YoutubeEntity,
  ContentChannelType,
  ProcessStatus,
} from "../../entity/youtube.entity";
import { YoutubeRequestEntity } from "../../entity/youtube-request.entity";
import { ArticleEntity } from "../../entity/article.entity";
import {
  getChannelByHandle,
  getChannelContentDetails,
  getPlaylistItems,
  searchVideos,
  getVideoDetails,
} from "../../remotes/youtube";
import { GlobalErrorHandler } from "../../util/error/global-error-handler";
import { sendDiscordMessage } from "../../remotes/discord/sendDiscordMessage";
import { CostcoSummaryService } from "../costco-summary";

// ChannelType은 ContentChannelType과 동일
export type ChannelType = ContentChannelType;

// Article 생성을 위한 DTO
interface CreateArticleDto {
  youtubeLink: string;
  topicTitle: string;
  category: string;
  title: string;
  content: string;
  summary: string;
  keywords: string[];
  products: any[];
}

const COCOSCAN_DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO";

interface ChannelConfig {
  handle: string;
  channelType: ChannelType;
}

/** channelType별 매장 브랜드명 매핑 */
const STORE_NAME_MAP: Record<ChannelType, string> = {
  costco: "코스트코",
  emart_traders: "이마트 트레이더스",
};

/**
 * channelType별 콘텐츠 필터링 키워드
 * (모든 키워드는 소문자로 비교되므로 대소문자를 구분하지 않습니다)
 */
const STORE_KEYWORD_MAP: Record<ChannelType, string[]> = {
  costco: ["코스트코", "costco"],
  emart_traders: [
    "트레이더스",
    "이마트 트레이더스",
    "이마트트레이더스",
    "traders",
    "emart traders",
  ],
};

const YOUTUBE_CHANNELS: ChannelConfig[] = [
  // 코스트코 채널
  { handle: "@살림맨", channelType: "costco" },
  { handle: "@daddykimcart", channelType: "costco" },
  { handle: "@코코덕", channelType: "costco" },
  { handle: "@3babypigs", channelType: "costco" },
  { handle: "@코스트코숏핑", channelType: "costco" },
  // 이마트 트레이더스 채널 (추후 추가)
];

export class CocoscanYoutubeService {
  private readonly costcoSummaryService: CostcoSummaryService;
  private readonly youtubeRepository: Repository<YoutubeEntity>;
  private readonly youtubeRequestRepository: Repository<YoutubeRequestEntity>;
  private readonly articleRepository: Repository<ArticleEntity>;

  constructor() {
    this.costcoSummaryService = new CostcoSummaryService();
    this.youtubeRepository = AppDataSource.getRepository(YoutubeEntity);
    this.youtubeRequestRepository =
      AppDataSource.getRepository(YoutubeRequestEntity);
    this.articleRepository = AppDataSource.getRepository(ArticleEntity);
  }

  /**
   * 자막을 분석하여 Article DTO를 준비합니다 (저장하지 않음)
   * @param videoLink 유튜브 영상 링크
   * @param caption 자막 원본
   * @param videoTitle 원본 영상 제목 (SEO 키워드 참고용)
   * @param storeName 매장 브랜드명 (예: '코스트코', '이마트 트레이더스')
   * @returns Article DTO 배열 (저장 준비 완료)
   */
  private async prepareArticles(
    videoLink: string,
    caption: string,
    videoTitle?: string,
    storeName: string = "코스트코"
  ): Promise<CreateArticleDto[]> {
    try {
      await this.sendDiscordNotification(
        `AI 요약 시작\n**제목:** ${
          videoTitle ?? "(없음)"
        }\n**매장:** ${storeName}`
      );

      // 1. CostcoSummaryService를 통해 Article 생성 (영상 제목, 매장명 전달)
      const generatedArticles =
        await this.costcoSummaryService.generateArticles(
          caption,
          videoTitle,
          storeName
        );

      if (generatedArticles.length === 0) {
        await this.sendDiscordNotification(
          `AI 요약 완료 (생성된 Article 없음)\n**제목:** ${
            videoTitle ?? "(없음)"
          }`
        );
        console.log("[Cocoscan Youtube] 생성된 Article이 없습니다.");
        return [];
      }

      await this.sendDiscordNotification(
        `AI 요약 완료\n**제목:** ${videoTitle ?? "(없음)"}\n**생성 주제:** ${
          generatedArticles.length
        }개`
      );

      // 2. CreateArticleDto 형태로 변환 (저장은 하지 않음)
      const articleDtos: CreateArticleDto[] = generatedArticles.map(
        (article) => ({
          youtubeLink: videoLink,
          topicTitle: article.topicTitle,
          category: article.category,
          title: article.title,
          content: article.content,
          summary: article.summary,
          keywords: article.keywords,
          products: article.products,
        })
      );

      console.log(
        `[Cocoscan Youtube] ${articleDtos.length}개 Article 준비 완료 (저장 대기 중)`
      );
      return articleDtos;
    } catch (error) {
      const errorMessage = `AI 요약 실패\n**제목:** ${
        videoTitle ?? "(없음)"
      }\n**에러:** ${error instanceof Error ? error.message : String(error)}`;
      console.error("[Cocoscan Youtube] Article 생성 실패:", error);
      await this.sendDiscordNotification(errorMessage, true);
      await GlobalErrorHandler.handleError(
        error as Error,
        "CocoscanYoutubeService.prepareArticles",
        { videoLink, videoTitle }
      );
      throw error;
    }
  }

  /**
   * 준비된 Article DTO들을 DB에 저장합니다
   * @param articleDtos 저장할 Article 데이터 배열
   * @param videoTitle 영상 제목 (Discord 알림용)
   * @returns 저장된 Article 개수
   */
  private async saveArticles(
    articleDtos: Array<{
      youtubeLink: string;
      topicTitle: string;
      category: string;
      title: string;
      content: string;
      summary: string;
      keywords: string[];
      products: any[];
    }>,
    videoTitle?: string
  ): Promise<number> {
    try {
      // ArticleEntity 생성 및 저장
      const articles = articleDtos.map((dto) =>
        this.articleRepository.create(dto)
      );
      const saved = await this.articleRepository.save(articles);

      console.log(`[Cocoscan Youtube] ${saved.length}개 Article 저장 완료`);
      await this.sendDiscordNotification(
        `Article 저장 완료\n**제목:** ${videoTitle ?? "(없음)"}\n**저장:** ${
          saved.length
        }개`
      );
      return saved.length;
    } catch (error) {
      const errorMessage = `Article 저장 실패\n**제목:** ${
        videoTitle ?? "(없음)"
      }\n**개수:** ${articleDtos.length}개\n**에러:** ${
        error instanceof Error ? error.message : String(error)
      }`;
      console.error("[Cocoscan Youtube] Article 저장 실패:", error);
      await this.sendDiscordNotification(errorMessage, true);
      await GlobalErrorHandler.handleError(
        error as Error,
        "CocoscanYoutubeService.saveArticles",
        { articleCount: articleDtos.length, videoTitle }
      );
      throw error;
    }
  }

  private async sendDiscordNotification(
    message: string,
    isError = false
  ): Promise<void> {
    try {
      const emoji = isError ? "🚨" : "✅";
      const timestamp = new Date().toISOString();
      const fullMessage = `${emoji} **Cocoscan Youtube**\n\n${message}\n\n**시간:** ${timestamp}`;
      await sendDiscordMessage(fullMessage, COCOSCAN_DISCORD_WEBHOOK_URL);
    } catch (error) {
      console.error("[Discord] 알림 전송 실패:", error);
    }
  }

  /**
   * 영상이 해당 매장과 관련이 있는지 확인합니다.
   */
  private isStoreRelated(
    channelType: ChannelType,
    title: string,
    description: string,
    caption: string | null
  ): boolean {
    const keywords = STORE_KEYWORD_MAP[channelType];
    const titleLower = title.toLowerCase();
    const descriptionLower = description.toLowerCase();
    const captionLower = caption?.toLowerCase() || "";

    return keywords.some(
      (keyword) =>
        titleLower.includes(keyword) ||
        descriptionLower.includes(keyword) ||
        captionLower.includes(keyword)
    );
  }

  /**
   * XML 자막 텍스트를 파싱하여 문자열로 반환합니다.
   */
  private parseCaptionXml(xml: string): string | null {
    const texts = xml.match(/<text[^>]*>(.*?)<\/text>/g);
    if (!texts) return null;

    return texts
      .map((t: string) =>
        t
          .replace(/<text[^>]*>/, "")
          .replace(/<\/text>/, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
      )
      .join(" ");
  }

  /**
   * 자막 트랙 목록에서 한국어 우선으로 자막 텍스트를 가져옵니다.
   */
  private async fetchCaptionFromTracks(
    tracks: Array<{ languageCode: string; baseUrl?: string }>
  ): Promise<string | null> {
    if (tracks.length === 0) return null;

    const koTrack = tracks.find((t) => t.languageCode === "ko");
    const track = koTrack || tracks[0];
    if (!track?.baseUrl) return null;

    const response = await fetch(track.baseUrl);
    if (!response.ok) return null;

    return this.parseCaptionXml(await response.text());
  }

  /**
   * ANDROID 클라이언트로 InnerTube API를 호출하여 자막을 가져옵니다.
   * WEB 클라이언트가 UNPLAYABLE을 반환하는 경우의 폴백
   */
  private async getCaptionFromAndroidClient(
    videoId: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
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
          `[Cocoscan Youtube] ANDROID 클라이언트 응답 실패: ${response.status}`
        );
        return null;
      }

      const data = await response.json();
      const status = data.playabilityStatus?.status;
      console.log(
        `[Cocoscan Youtube] ANDROID 클라이언트 상태 (${videoId}): ${status}`
      );

      if (status !== "OK") return null;

      const tracks =
        data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks || tracks.length === 0) {
        console.log(
          `[Cocoscan Youtube] ANDROID 클라이언트: captionTracks 없음 (${videoId})`
        );
        return null;
      }

      const caption = await this.fetchCaptionFromTracks(tracks);
      if (caption) {
        console.log(
          `[Cocoscan Youtube] ANDROID 폴백으로 캡션 추출 성공 (${videoId}): ${caption.length}자`
        );
      }
      return caption;
    } catch (error) {
      console.error(`ANDROID 폴백 캡션 추출 실패 (${videoId}):`, error);
      return null;
    }
  }

  /**
   * YouTube 페이지에서 직접 자막 URL을 추출하여 자막을 가져옵니다.
   */
  private async getCaptionFromPage(videoId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          },
        }
      );

      if (!response.ok) return null;

      const html = await response.text();
      const match = html.match(/"captionTracks":(\[.*?\])/);
      if (!match) {
        console.log(
          `[Cocoscan Youtube] 페이지에서 captionTracks 없음 (${videoId})`
        );
        return null;
      }

      const tracks = JSON.parse(match[1].replace(/\\u0026/g, "&"));
      const caption = await this.fetchCaptionFromTracks(tracks);
      if (caption) {
        console.log(
          `[Cocoscan Youtube] 페이지 폴백으로 캡션 추출 성공 (${videoId}): ${caption.length}자`
        );
      }
      return caption;
    } catch (error) {
      console.error(`페이지 폴백 캡션 추출 실패 (${videoId}):`, error);
      return null;
    }
  }

  /**
   * 유튜브 영상의 자막(캡션)을 가져옵니다.
   * 1차: youtube-caption-extractor (InnerTube WEB 클라이언트)
   * 2차: InnerTube ANDROID 클라이언트
   * 3차: YouTube 페이지 스크래핑
   */
  private async getVideoCaption(videoId: string): Promise<string | null> {
    // 1차: youtube-caption-extractor (WEB)
    try {
      const koCaption = await getSubtitles({ videoID: videoId, lang: "ko" });
      if (koCaption && koCaption.length > 0) {
        return koCaption.map((c: any) => c.text || c).join(" ");
      }

      const enCaption = await getSubtitles({ videoID: videoId, lang: "en" });
      if (enCaption && enCaption.length > 0) {
        return enCaption.map((c: any) => c.text || c).join(" ");
      }
    } catch (error) {
      console.log(`[Cocoscan Youtube] WEB 클라이언트 자막 실패 (${videoId})`);
    }

    // 2차: ANDROID 클라이언트
    console.log(`[Cocoscan Youtube] ANDROID 클라이언트 폴백 시도 (${videoId})`);
    const androidCaption = await this.getCaptionFromAndroidClient(videoId);
    if (androidCaption) return androidCaption;

    // 3차: 페이지 스크래핑
    console.log(`[Cocoscan Youtube] 페이지 스크래핑 폴백 시도 (${videoId})`);
    return this.getCaptionFromPage(videoId);
  }

  /**
   * 키워드 검색을 기반으로 영상을 수집하고 처리합니다.
   * @param keyword 검색어
   * @param channelType 매장 타입
   */
  private async processSearchBasedVideos(
    keyword: string,
    channelType: ChannelType
  ): Promise<{ processed: number; created: number; errors: number }> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return { processed: 0, created: 0, errors: 0 };

    const storeName = STORE_NAME_MAP[channelType];
    console.log(
      `[Cocoscan Youtube] '${keyword}' 키워드로 검색 기반 수집 시작...`
    );

    let processedCount = 0;
    let createdCount = 0;
    let errorCount = 0;

    try {
      const searchResult = await searchVideos(keyword, apiKey, 10);
      if (!searchResult || searchResult.items.length === 0) {
        console.log(`[Cocoscan Youtube] '${keyword}' 검색 결과가 없습니다.`);
        return { processed: 0, created: 0, errors: 0 };
      }

      for (const item of searchResult.items) {
        try {
          const videoId = item.id.videoId;
          const link = `https://www.youtube.com/watch?v=${videoId}`;
          const title = item.snippet.title;

          // 1차 필터: 이미 등록된 영상인지 확인
          const existingVideo = await this.youtubeRepository.findOne({
            where: { link },
          });
          if (existingVideo) {
            console.log(
              `[Cocoscan Youtube]   - [스킵] ${title} (이미 등록된 링크)`
            );
            continue;
          }

          processedCount++;

          // 캡션 가져오기
          console.log(`[Cocoscan Youtube]   - 캡션 가져오는 중: ${title}`);
          const caption = await this.getVideoCaption(videoId);

          if (!caption) {
            console.log(`[Cocoscan Youtube]   - [스킵] ${title} (캡션 없음)`);
            continue;
          }

          // 2차 필터: 캡션 내 키워드 포함 여부 및 길이 체크 (200자 이상)
          if (!this.isStoreRelated(channelType, title, "", caption)) {
            console.log(
              `[Cocoscan Youtube]   - [스킵] ${title} (${storeName} 관련 키워드 없음)`
            );
            continue;
          }

          if (caption.length < 200) {
            console.log(
              `[Cocoscan Youtube]   - [스킵] ${title} (캡션 길이 부족: ${caption.length}자)`
            );
            continue;
          }

          // 에이전트 실행 및 저장
          console.log(
            `[Cocoscan Youtube]   - 에이전트로 Article 생성 중 (${storeName}): ${title}`
          );

          // 1. Article 먼저 준비 (저장하지 않음)
          const articleDtos = await this.prepareArticles(
            link,
            caption,
            title,
            storeName
          );

          // 2. Article이 성공적으로 준비되었으면 YouTube + Article 함께 저장
          if (articleDtos.length > 0) {
            // 2-1. YoutubeEntity 저장
            const youtube = this.youtubeRepository.create({
              link,
              channelName: item.snippet.channelTitle,
              channelId: item.snippet.channelId,
              channelType,
              title,
              snippet: item.snippet.description,
              publishedAt: new Date(item.snippet.publishedAt),
              thumbnail: item.snippet.thumbnails.high?.url,
              sourceType: "auto",
              processStatus: "pending",
            });
            await this.youtubeRepository.save(youtube);
            await this.sendDiscordNotification(
              `Youtube 저장 완료\n**제목:** ${title}\n**매장:** ${storeName}\n**검색어:** ${keyword}`
            );

            // 2-2. Article 저장
            const articlesCreated = await this.saveArticles(articleDtos, title);

            console.log(
              `[Cocoscan Youtube]   - ✅ 등록 완료: ${title} (${articlesCreated}개 Article)`
            );
            createdCount++;
            await this.sendDiscordNotification(
              `✅ 검색 기반 영상 등록 완료\n**검색어:** ${keyword}\n**제목:** ${title}\n**Article:** ${articlesCreated}개`
            );
          } else {
            console.log(
              `[Cocoscan Youtube]   - [스킵] ${title} (Article 생성 실패)`
            );
            await this.sendDiscordNotification(
              `⚠️ Article 생성 실패로 건너뜀\n**검색어:** ${keyword}\n**제목:** ${title}`,
              true
            );
          }
        } catch (error) {
          errorCount++;
          const errorMessage = `검색 결과 처리 중 오류\n**검색어:** ${keyword}\n**영상:** ${
            item.snippet.title
          }\n**에러:** ${
            error instanceof Error ? error.message : String(error)
          }`;
          console.error(
            `[Cocoscan Youtube] 검색 결과 처리 중 오류 (${item.snippet.title}):`,
            error
          );
          await this.sendDiscordNotification(errorMessage, true);
          await GlobalErrorHandler.handleError(
            error as Error,
            "CocoscanYoutubeService.processSearchBasedVideos",
            { videoId: item.id.videoId, keyword }
          );
        }
      }

      return {
        processed: processedCount,
        created: createdCount,
        errors: errorCount,
      };
    } catch (error) {
      console.error(
        `[Cocoscan Youtube] 검색 기반 수집 실패 (${keyword}):`,
        error
      );
      return { processed: 0, created: 0, errors: 1 };
    }
  }

  /**
   * 유튜브 URL에서 videoId 추출
   */
  private extractVideoId(url: string): string {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]+)/);
    return match ? match[1] : "";
  }

  /**
   * 미처리 수동 URL 조회
   * youtube_request 테이블에서 processStatus='pending' 조회
   */
  private async findUnprocessedManualUrls(): Promise<YoutubeRequestEntity[]> {
    try {
      const unprocessed = await this.youtubeRequestRepository.find({
        where: [
          { processStatus: "pending" },
          { processStatus: "skipped" },
          { processStatus: "failed" },
        ],
        order: {
          createdAt: "ASC",
        },
      });

      return unprocessed;
    } catch (error) {
      console.error("[Cocoscan Youtube] 미처리 수동 URL 조회 실패:", error);
      await this.sendDiscordNotification(
        `미처리 수동 URL 조회 실패\n**에러:** ${
          error instanceof Error ? error.message : String(error)
        }`,
        true
      );
      return [];
    }
  }

  /**
   * youtube_request 처리 상태 업데이트
   */
  private async updateRequestStatus(
    requestId: number,
    status: ProcessStatus,
    message?: string
  ): Promise<void> {
    try {
      await this.youtubeRequestRepository.update(requestId, {
        processStatus: status,
        processMessage: message || null,
        processedAt: new Date(),
      });
    } catch (error) {
      console.error("[Cocoscan Youtube] 요청 상태 업데이트 실패:", error);
    }
  }

  /**
   * 수동 요청 처리 (youtube_request → youtube + article)
   * 키워드 필터 스킵 (사용자가 명시적으로 등록한 URL이므로)
   * 성공 시 youtube 테이블에 완성된 데이터를 직접 저장
   */
  private async processManualRequest(
    request: YoutubeRequestEntity
  ): Promise<void> {
    const videoId = this.extractVideoId(request.link);
    if (!videoId) {
      console.log(`[Cocoscan Youtube] 유효하지 않은 URL: ${request.link}`);
      await this.updateRequestStatus(request.id, "failed", "유효하지 않은 URL");
      return;
    }

    const storeName = STORE_NAME_MAP[request.channelType || "costco"];

    // processing 상태로 변경
    await this.updateRequestStatus(request.id, "processing", "처리 중");

    try {
      // 1. YouTube API로 메타데이터 조회
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        await this.updateRequestStatus(
          request.id,
          "failed",
          "YOUTUBE_API_KEY 없음"
        );
        return;
      }

      const videoInfo = await getVideoDetails(videoId, apiKey);
      if (!videoInfo?.items?.length) {
        await this.updateRequestStatus(
          request.id,
          "failed",
          "YouTube API에서 영상 정보를 찾을 수 없음"
        );
        return;
      }

      const snippet = videoInfo.items[0].snippet;
      const videoTitle = snippet.title;
      console.log(`[Cocoscan Youtube] 수동 요청 처리 중: ${videoTitle}`);

      // 2. 자막 추출
      const caption = await this.getVideoCaption(videoId);

      if (!caption) {
        await this.sendDiscordNotification(
          `자막 없음으로 건너뜀\n**URL:** ${request.link}`,
          true
        );
        await this.updateRequestStatus(request.id, "skipped", "자막 없음");
        return;
      }

      if (caption.length < 200) {
        await this.sendDiscordNotification(
          `자막 길이 부족으로 건너뜀 (${caption.length}자)\n**URL:** ${request.link}`,
          true
        );
        await this.updateRequestStatus(
          request.id,
          "skipped",
          `자막 길이 부족 (${caption.length}자)`
        );
        return;
      }

      // 3. AI 요약 (키워드 필터 스킵 — 사용자가 명시적으로 등록한 URL)
      console.log(
        `[Cocoscan Youtube]   - 에이전트로 Article 생성 중 (${storeName}): ${videoTitle}`
      );

      const articleDtos = await this.prepareArticles(
        request.link,
        caption,
        videoTitle,
        storeName
      );

      if (articleDtos.length === 0) {
        await this.sendDiscordNotification(
          `Article 생성 실패로 건너뜀\n**URL:** ${request.link}`,
          true
        );
        await this.updateRequestStatus(
          request.id,
          "skipped",
          "Article 생성 실패"
        );
        return;
      }

      // 4. youtube 테이블에 완성된 데이터 저장
      const youtube = this.youtubeRepository.create({
        link: request.link,
        channelName: snippet.channelTitle,
        channelId: snippet.channelId,
        channelType: request.channelType,
        title: videoTitle,
        snippet: snippet.description,
        publishedAt: new Date(snippet.publishedAt),
        thumbnail:
          snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url,
        sourceType: "manual",
        processStatus: "completed",
        processMessage: `처리 완료: ${articleDtos.length}개 Article 생성`,
        processedAt: new Date(),
      });
      await this.youtubeRepository.save(youtube);

      // 5. article 테이블에 저장
      const articlesCreated = await this.saveArticles(articleDtos, videoTitle);

      console.log(
        `[Cocoscan Youtube]   - 수동 요청 처리 완료: ${videoTitle} (${articlesCreated}개 Article)`
      );
      await this.sendDiscordNotification(
        `수동 URL 처리 완료\n**제목:** ${videoTitle}\n**Article:** ${articlesCreated}개\n**URL:** ${request.link}`
      );

      // 6. youtube_request 상태를 completed로 업데이트
      await this.updateRequestStatus(
        request.id,
        "completed",
        `처리 완료: ${articlesCreated}개 Article 생성`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.updateRequestStatus(request.id, "failed", errorMessage);
      throw error;
    }
  }

  /**
   * 수동 등록 URL 처리 (youtube_request → youtube + article)
   */
  private async processManualUrls(): Promise<void> {
    console.log("[Cocoscan Youtube] 수동 URL 처리 시작");

    const requests = await this.findUnprocessedManualUrls();

    if (requests.length === 0) {
      console.log("[Cocoscan Youtube] 처리할 수동 URL 없음");
      return;
    }

    console.log(`[Cocoscan Youtube] ${requests.length}개 수동 URL 처리 중...`);
    await this.sendDiscordNotification(
      `수동 URL 처리 시작\n**처리 대상:** ${requests.length}개`
    );

    let successCount = 0;
    let failCount = 0;

    for (const request of requests) {
      try {
        await this.processManualRequest(request);
        successCount++;
      } catch (error) {
        failCount++;
        console.error(`[Cocoscan Youtube] 처리 실패: ${request.link}`, error);
        await this.sendDiscordNotification(
          `수동 URL 처리 실패\n**URL:** ${request.link}\n**에러:** ${
            error instanceof Error ? error.message : String(error)
          }`,
          true
        );
      }
    }

    console.log(
      `[Cocoscan Youtube] 수동 URL 처리 완료 (성공: ${successCount}, 실패: ${failCount})`
    );
    await this.sendDiscordNotification(
      `수동 URL 처리 완료\n**성공:** ${successCount}개\n**실패:** ${failCount}개`
    );
  }

  /**
   * 등록된 채널들을 모니터링하여 새로운 영상을 처리합니다.
   */
  async process(): Promise<void> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      const errorMsg = "YOUTUBE_API_KEY 환경 변수가 설정되지 않았습니다.";
      console.error(errorMsg);
      await this.sendDiscordNotification(errorMsg, true);
      return;
    }

    if (YOUTUBE_CHANNELS.length === 0) {
      const msg = "모니터링할 유튜브 채널이 설정되지 않았습니다.";
      console.log(`[Cocoscan Youtube] ${msg}`);
      await this.sendDiscordNotification(msg, true);
      return;
    }

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalErrors = 0;

    try {
      // 1. 수동 등록 URL 처리 (먼저 처리)
      await this.processManualUrls();

      // 2. 기존: 채널 모니터링 (자동 크롤링)
      for (const channel of YOUTUBE_CHANNELS) {
        const { handle, channelType } = channel;
        const storeName = STORE_NAME_MAP[channelType];

        try {
          const channelResponse = await getChannelByHandle(handle, apiKey);
          if (!channelResponse || channelResponse.items.length === 0) {
            console.log(
              `[Cocoscan Youtube] ${handle}: 채널을 찾을 수 없습니다.`
            );
            continue;
          }

          const channelId = channelResponse.items[0].id;
          console.log(`[Cocoscan Youtube] ${handle}: 채널 ID = ${channelId}`);

          const contentDetailsResponse = await getChannelContentDetails(
            channelId,
            apiKey
          );
          if (
            !contentDetailsResponse ||
            contentDetailsResponse.items.length === 0
          ) {
            console.log(
              `[Cocoscan Youtube] ${handle}: contentDetails를 찾을 수 없습니다.`
            );
            continue;
          }

          const uploadsPlaylistId =
            contentDetailsResponse.items[0].contentDetails.relatedPlaylists
              .uploads;
          if (!uploadsPlaylistId) {
            console.log(
              `[Cocoscan Youtube] ${handle}: uploads 플레이리스트를 찾을 수 없습니다.`
            );
            continue;
          }

          console.log(
            `[Cocoscan Youtube] ${handle}: 플레이리스트 ID = ${uploadsPlaylistId}`
          );

          const playlistItemsResponse = await getPlaylistItems(
            uploadsPlaylistId,
            apiKey,
            2
          );
          if (
            !playlistItemsResponse ||
            playlistItemsResponse.items.length === 0
          ) {
            console.log(
              `[Cocoscan Youtube] ${handle}: 영상 목록을 찾을 수 없습니다.`
            );
            continue;
          }

          console.log(
            `[Cocoscan Youtube] ${handle}: 총 ${playlistItemsResponse.pageInfo.totalResults}개의 영상 중 최근 ${playlistItemsResponse.items.length}개 조회 완료`
          );

          let registeredLinks: Set<string> = new Set();
          try {
            // 첫 페이지만 조회 (등록 여부 확인용)
            const registeredVideos = await this.youtubeRepository.find({
              where: { channelId },
              take: 100,
              select: ["link"],
            });
            registeredLinks = new Set(registeredVideos.map((v) => v.link));
            console.log(
              `[Cocoscan Youtube] ${handle}: 이미 등록된 영상 ${registeredLinks.size}개 확인`
            );
          } catch (error) {
            console.error(
              `[Cocoscan Youtube] ${handle}: 등록된 영상 목록 조회 실패:`,
              error
            );
            await GlobalErrorHandler.handleError(
              error as Error,
              "CocoscanYoutubeService.findByChannelIdYoutube",
              { channelId, handle }
            );
          }

          const unregisteredVideos: Array<{
            videoId: string;
            link: string;
            title: string;
            snippet?: string;
            channelName: string;
            publishedAt: string;
            thumbnail?: string;
          }> = [];

          for (const item of playlistItemsResponse.items) {
            const videoId = item.contentDetails.videoId;
            const link = `https://www.youtube.com/watch?v=${videoId}`;

            if (registeredLinks.has(link)) {
              console.log(
                `[Cocoscan Youtube]   - [스킵] ${item.snippet.title} (이미 등록됨)`
              );
              continue;
            }

            unregisteredVideos.push({
              videoId,
              link,
              title: item.snippet.title,
              snippet: item.snippet.description,
              channelName: item.snippet.channelTitle,
              publishedAt: item.contentDetails.videoPublishedAt,
              thumbnail: item.snippet.thumbnails.high?.url,
            });
          }

          console.log(
            `[Cocoscan Youtube] ${handle}: 등록되지 않은 영상 ${unregisteredVideos.length}개 발견`
          );

          let channelProcessed = 0;
          let channelCreated = 0;
          let channelErrors = 0;

          for (const video of unregisteredVideos) {
            try {
              channelProcessed++;
              totalProcessed++;

              // 제목/설명에 관련 키워드가 있는지 먼저 확인 (효율성 개선)
              const hasStoreInTitleOrSnippet = this.isStoreRelated(
                channelType,
                video.title,
                video.snippet || "",
                null
              );

              // 캡션 가져오기
              console.log(
                `[Cocoscan Youtube]   - 캡션 가져오는 중: ${video.title}`
              );
              const caption = await this.getVideoCaption(video.videoId);

              // 제목/설명에 키워드가 없으면 캡션으로 추가 확인
              if (!hasStoreInTitleOrSnippet) {
                if (
                  !this.isStoreRelated(
                    channelType,
                    video.title,
                    video.snippet || "",
                    caption
                  )
                ) {
                  console.log(
                    `[Cocoscan Youtube]   - [스킵] ${video.title} (${storeName} 관련 없음)`
                  );
                  continue;
                }
              }

              // 캡션이 없으면 스킵
              if (!caption) {
                console.log(
                  `[Cocoscan Youtube]   - [스킵] ${video.title} (캡션 없음)`
                );
                continue;
              }

              // 에이전트 기반으로 Article 생성 및 저장
              console.log(
                `[Cocoscan Youtube]   - 에이전트로 Article 생성 중 (${storeName}): ${video.title}`
              );

              // 1. Article 먼저 준비 (저장하지 않음)
              const articleDtos = await this.prepareArticles(
                video.link,
                caption,
                video.title,
                storeName
              );

              // 2. Article이 성공적으로 준비되었으면 YouTube + Article 함께 저장
              if (articleDtos.length > 0) {
                // 2-1. YoutubeEntity 저장 (메타데이터 + channelType)
                const youtube = this.youtubeRepository.create({
                  link: video.link,
                  channelName: video.channelName,
                  channelId: channelId,
                  channelType: channelType,
                  title: video.title,
                  snippet: video.snippet,
                  publishedAt: new Date(video.publishedAt),
                  thumbnail: video.thumbnail,
                  sourceType: "auto",
                  processStatus: "pending",
                });
                await this.youtubeRepository.save(youtube);
                await this.sendDiscordNotification(
                  `Youtube 저장 완료\n**제목:** ${video.title}\n**매장:** ${storeName}\n**채널:** ${handle}`
                );

                // 2-2. Article 저장
                const articlesCreated = await this.saveArticles(
                  articleDtos,
                  video.title
                );

                console.log(
                  `[Cocoscan Youtube]   - ✅ 등록 완료: ${video.title} (${articlesCreated}개 Article)`
                );
                channelCreated++;
                totalCreated++;
                await this.sendDiscordNotification(
                  `✅ 영상 등록 완료\n**채널:** ${handle}\n**제목:** ${video.title}\n**Article:** ${articlesCreated}개`
                );
              } else {
                console.log(
                  `[Cocoscan Youtube]   - [스킵] ${video.title} (Article 생성 실패)`
                );
                await this.sendDiscordNotification(
                  `⚠️ Article 생성 실패로 건너뜀\n**채널:** ${handle}\n**제목:** ${video.title}`,
                  true
                );
              }
            } catch (error) {
              channelErrors++;
              totalErrors++;
              const errorMessage = `캡션/콘텐츠 처리 실패\n**채널:** ${handle}\n**영상:** ${
                video.title
              }\n**에러:** ${
                error instanceof Error ? error.message : String(error)
              }`;
              console.error(
                `[Cocoscan Youtube] 캡션/콘텐츠 처리 실패 (${video.title}):`,
                error
              );
              await this.sendDiscordNotification(errorMessage, true);
              await GlobalErrorHandler.handleError(
                error as Error,
                "CocoscanYoutubeService.processVideo",
                { videoId: video.videoId, handle }
              );
            }
          }

          // 채널 처리 완료 알림 (새로 등록한 영상이 있을 때만)
          if (channelCreated > 0) {
            await this.sendDiscordNotification(
              `채널 처리 완료\n**채널:** ${handle}\n**처리:** ${channelProcessed}개\n**생성:** ${channelCreated}개${
                channelErrors > 0 ? `\n**에러:** ${channelErrors}개 ⚠️` : ""
              }`
            );
          }
        } catch (error) {
          totalErrors++;
          const errorMessage = `채널 처리 실패\n**채널:** ${handle}\n**에러:** ${
            error instanceof Error ? error.message : String(error)
          }`;
          await this.sendDiscordNotification(errorMessage, true);
          await GlobalErrorHandler.handleError(
            error as Error,
            "CocoscanYoutubeService.processChannel",
            { handle }
          );
        }
      }

      // 검색 기반 수집 추가 (이마트 트레이더스)
      const searchResult = await this.processSearchBasedVideos(
        "이마트 트레이더스",
        "emart_traders"
      );
      totalProcessed += searchResult.processed;
      totalCreated += searchResult.created;
      totalErrors += searchResult.errors;

      // 최종 통계 알림
      if (totalProcessed > 0 || totalCreated > 0 || totalErrors > 0) {
        await this.sendDiscordNotification(
          `전체 작업 완료\n**총 처리:** ${totalProcessed}개 영상\n**총 생성:** ${totalCreated}개 영상\n**총 에러:** ${totalErrors}개 ⚠️`
        );
      }
    } catch (error) {
      // 전체 프로세스 에러 알림
      const errorMessage = `전체 작업 실패\n**에러:** ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.sendDiscordNotification(errorMessage, true);
      await GlobalErrorHandler.handleError(
        error as Error,
        "CocoscanYoutubeService.process"
      );
    }
  }
}
