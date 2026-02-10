import { Repository } from "typeorm";
import { AppDataSource } from "../../database/data-source";
import { YoutubeEntity, ContentChannelType } from "../../entity/youtube.entity";
import {
  getChannelByHandle,
  getChannelContentDetails,
  getPlaylistItems,
  searchVideos,
} from "../../remotes/youtube";
import { GlobalErrorHandler } from "../../util/error/global-error-handler";
import { sendDiscordMessage } from "../../remotes/discord/sendDiscordMessage";
import { CaptionExtractionService } from "./services/caption-extraction.service";
import { ArticlePersistenceService } from "./services/article-persistence.service";
import { ManualUrlProcessorService } from "./services/manual-url-processor.service";

// ChannelType은 ContentChannelType과 동일
export type ChannelType = ContentChannelType;

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
  private readonly captionService: CaptionExtractionService;
  private readonly articleService: ArticlePersistenceService;
  private readonly manualUrlProcessor: ManualUrlProcessorService;
  private readonly youtubeRepository: Repository<YoutubeEntity>;

  constructor() {
    this.captionService = new CaptionExtractionService();
    this.articleService = new ArticlePersistenceService();
    this.manualUrlProcessor = new ManualUrlProcessorService(
      this.captionService,
      this.articleService
    );
    this.youtubeRepository = AppDataSource.getRepository(YoutubeEntity);
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
      // 배치 시작 시 서킷 브레이커 초기화
      this.captionService.resetCircuitBreaker();

      // 1. 수동 등록 URL 처리 (먼저 처리)
      await this.manualUrlProcessor.processAll();

      // 2. 기존: 채널 모니터링 (자동 크롤링)
      for (const channel of YOUTUBE_CHANNELS) {
        const { handle, channelType } = channel;

        try {
          const result = await this.processChannel(handle, channelType, apiKey);
          totalProcessed += result.processed;
          totalCreated += result.created;
          totalErrors += result.errors;
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

      // 3. 검색 기반 수집 (이마트 트레이더스)
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

  /**
   * 단일 채널의 최신 영상을 처리합니다.
   */
  private async processChannel(
    handle: string,
    channelType: ChannelType,
    apiKey: string
  ): Promise<{ processed: number; created: number; errors: number }> {
    const storeName = STORE_NAME_MAP[channelType];

    const channelResponse = await getChannelByHandle(handle, apiKey);
    if (!channelResponse || channelResponse.items.length === 0) {
      console.log(`[Cocoscan Youtube] ${handle}: 채널을 찾을 수 없습니다.`);
      return { processed: 0, created: 0, errors: 0 };
    }

    const channelId = channelResponse.items[0].id;
    console.log(`[Cocoscan Youtube] ${handle}: 채널 ID = ${channelId}`);

    const contentDetailsResponse = await getChannelContentDetails(
      channelId,
      apiKey
    );
    if (!contentDetailsResponse || contentDetailsResponse.items.length === 0) {
      console.log(
        `[Cocoscan Youtube] ${handle}: contentDetails를 찾을 수 없습니다.`
      );
      return { processed: 0, created: 0, errors: 0 };
    }

    const uploadsPlaylistId =
      contentDetailsResponse.items[0].contentDetails.relatedPlaylists.uploads;
    if (!uploadsPlaylistId) {
      console.log(
        `[Cocoscan Youtube] ${handle}: uploads 플레이리스트를 찾을 수 없습니다.`
      );
      return { processed: 0, created: 0, errors: 0 };
    }

    console.log(
      `[Cocoscan Youtube] ${handle}: 플레이리스트 ID = ${uploadsPlaylistId}`
    );

    const playlistItemsResponse = await getPlaylistItems(
      uploadsPlaylistId,
      apiKey,
      2
    );
    if (!playlistItemsResponse || playlistItemsResponse.items.length === 0) {
      console.log(
        `[Cocoscan Youtube] ${handle}: 영상 목록을 찾을 수 없습니다.`
      );
      return { processed: 0, created: 0, errors: 0 };
    }

    console.log(
      `[Cocoscan Youtube] ${handle}: 총 ${playlistItemsResponse.pageInfo.totalResults}개의 영상 중 최근 ${playlistItemsResponse.items.length}개 조회 완료`
    );

    let registeredLinks: Set<string> = new Set();
    try {
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

    for (let i = 0; i < unregisteredVideos.length; i++) {
      const video = unregisteredVideos[i];
      // 429 방지: 영상 간 딜레이
      if (i > 0) {
        console.log(
          `[Cocoscan Youtube]   - ${CocoscanYoutubeService.VIDEO_DELAY_SEC}초 대기 (429 방지)`
        );
        await this.delay(CocoscanYoutubeService.VIDEO_DELAY_SEC * 1000);
      }
      try {
        channelProcessed++;

        // 제목/설명에 관련 키워드가 있는지 먼저 확인
        const hasStoreInTitleOrSnippet = this.isStoreRelated(
          channelType,
          video.title,
          video.snippet || "",
          null
        );

        // 캡션 가져오기
        console.log(`[Cocoscan Youtube]   - 캡션 가져오는 중: ${video.title}`);
        const caption = await this.captionService.getVideoCaption(
          video.videoId
        );

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
        const articleDtos = await this.articleService.prepareArticles(
          video.link,
          caption,
          video.title,
          storeName
        );

        // 2. Article이 성공적으로 준비되었으면 YouTube + Article 함께 저장
        if (articleDtos.length > 0) {
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

          const articlesCreated = await this.articleService.saveArticles(
            articleDtos,
            video.title
          );

          console.log(
            `[Cocoscan Youtube]   - ✅ 등록 완료: ${video.title} (${articlesCreated}개 Article)`
          );
          channelCreated++;
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
        const errorMessage = `캡션/콘텐츠 처리 실패\n**채널:** ${handle}\n**영상:** ${
          video.title
        }\n**에러:** ${error instanceof Error ? error.message : String(error)}`;
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

    return {
      processed: channelProcessed,
      created: channelCreated,
      errors: channelErrors,
    };
  }

  /**
   * 키워드 검색을 기반으로 영상을 수집하고 처리합니다.
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

      for (let i = 0; i < searchResult.items.length; i++) {
        const item = searchResult.items[i];
        // 429 방지: 영상 간 딜레이
        if (i > 0) {
          console.log(
            `[Cocoscan Youtube]   - ${CocoscanYoutubeService.VIDEO_DELAY_SEC}초 대기 (429 방지)`
          );
          await this.delay(CocoscanYoutubeService.VIDEO_DELAY_SEC * 1000);
        }
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
          const caption = await this.captionService.getVideoCaption(videoId);

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
          const articleDtos = await this.articleService.prepareArticles(
            link,
            caption,
            title,
            storeName
          );

          // 2. Article이 성공적으로 준비되었으면 YouTube + Article 함께 저장
          if (articleDtos.length > 0) {
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

            const articlesCreated = await this.articleService.saveArticles(
              articleDtos,
              title
            );

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

  /** 429 방지를 위한 영상 간 딜레이 (초) */
  private static readonly VIDEO_DELAY_SEC = 10;

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractVideoId(url: string): string {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
    return match ? match[1] : "";
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
}
