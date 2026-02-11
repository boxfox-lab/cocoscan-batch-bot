import { Repository } from "typeorm";
import { AppDataSource } from "../../../database/data-source";
import {
  YoutubeEntity,
  ContentChannelType,
  ProcessStatus,
} from "../../../entity/youtube.entity";
import { YoutubeRequestEntity } from "../../../entity/youtube-request.entity";
import { getVideoDetails, QuotaExceededError } from "../../../remotes/youtube";
import { YoutubeApiKeyManager } from "../../../config/youtube-api-key-manager";
import { sendDiscordMessage } from "../../../remotes/discord/sendDiscordMessage";
import { CaptionExtractionService } from "./caption-extraction.service";
import { ArticlePersistenceService } from "./article-persistence.service";

const COCOSCAN_DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO";

/** channelType별 매장 브랜드명 매핑 */
const STORE_NAME_MAP: Record<ContentChannelType, string> = {
  costco: "코스트코",
  emart_traders: "이마트 트레이더스",
};

export class ManualUrlProcessorService {
  private readonly captionService: CaptionExtractionService;
  private readonly articleService: ArticlePersistenceService;
  private readonly youtubeRepository: Repository<YoutubeEntity>;
  private readonly youtubeRequestRepository: Repository<YoutubeRequestEntity>;

  constructor(
    captionService: CaptionExtractionService,
    articleService: ArticlePersistenceService,
  ) {
    this.captionService = captionService;
    this.articleService = articleService;
    this.youtubeRepository = AppDataSource.getRepository(YoutubeEntity);
    this.youtubeRequestRepository =
      AppDataSource.getRepository(YoutubeRequestEntity);
  }

  /**
   * 미처리 수동 URL 일괄 처리
   */
  async processAll(): Promise<void> {
    console.log("[ManualUrlProcessor] 수동 URL 처리 시작");

    const requests = await this.findUnprocessedUrls();

    if (requests.length === 0) {
      console.log("[ManualUrlProcessor] 처리할 수동 URL 없음");
      return;
    }

    console.log(
      `[ManualUrlProcessor] ${requests.length}개 수동 URL 처리 중...`,
    );
    await this.sendNotification(
      `수동 URL 처리 시작\n**처리 대상:** ${requests.length}개`,
    );

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      // 429 방지: 요청 간 10초 딜레이
      if (i > 0) {
        console.log("[ManualUrlProcessor] 10초 대기 (429 방지)");
        await this.delay(10_000);
      }

      try {
        await this.processRequest(request);
        successCount++;
      } catch (error) {
        // QuotaExceededError는 상위로 전파
        if (error instanceof QuotaExceededError) throw error;

        failCount++;
        console.error(`[ManualUrlProcessor] 처리 실패: ${request.link}`, error);
        await this.sendNotification(
          `수동 URL 처리 실패\n**URL:** ${request.link}\n**에러:** ${
            error instanceof Error ? error.message : String(error)
          }`,
          true,
        );
      }
    }

    console.log(
      `[ManualUrlProcessor] 수동 URL 처리 완료 (성공: ${successCount}, 실패: ${failCount})`,
    );
    await this.sendNotification(
      `수동 URL 처리 완료\n**성공:** ${successCount}개\n**실패:** ${failCount}개`,
    );
  }

  /**
   * 수동 요청 단건 처리 (youtube_request → youtube + article)
   * 키워드 필터 스킵 (사용자가 명시적으로 등록한 URL이므로)
   */
  private async processRequest(request: YoutubeRequestEntity): Promise<void> {
    const videoId = this.extractVideoId(request.link);
    if (!videoId) {
      console.log(`[ManualUrlProcessor] 유효하지 않은 URL: ${request.link}`);
      await this.updateStatus(request.id, "failed", "유효하지 않은 URL");
      return;
    }

    const storeName = STORE_NAME_MAP[request.channelType || "costco"];

    // processing 상태로 변경
    await this.updateStatus(request.id, "processing", "처리 중");

    try {
      // 1. YouTube API로 메타데이터 조회
      const apiKey = YoutubeApiKeyManager.getInstance().getKey();
      if (!apiKey) {
        await this.updateStatus(
          request.id,
          "failed",
          "사용 가능한 YouTube API 키 없음",
        );
        return;
      }

      const videoInfo = await getVideoDetails(videoId, apiKey);
      if (!videoInfo?.items?.length) {
        await this.updateStatus(
          request.id,
          "failed",
          "YouTube API에서 영상 정보를 찾을 수 없음",
        );
        return;
      }

      const snippet = videoInfo.items[0].snippet;
      const videoTitle = snippet.title;
      console.log(`[ManualUrlProcessor] 수동 요청 처리 중: ${videoTitle}`);

      // 2. 자막 추출
      const caption = await this.captionService.getVideoCaption(videoId);

      if (!caption) {
        await this.sendNotification(
          `자막 없음으로 건너뜀\n**URL:** ${request.link}`,
          true,
        );
        await this.updateStatus(request.id, "skipped", "자막 없음");
        return;
      }

      if (caption.length < 200) {
        await this.sendNotification(
          `자막 길이 부족으로 건너뜀 (${caption.length}자)\n**URL:** ${request.link}`,
          true,
        );
        await this.updateStatus(
          request.id,
          "skipped",
          `자막 길이 부족 (${caption.length}자)`,
        );
        return;
      }

      // 3. AI 요약 (키워드 필터 스킵)
      console.log(
        `[ManualUrlProcessor]   - 에이전트로 Article 생성 중 (${storeName}): ${videoTitle}`,
      );

      const articleDtos = await this.articleService.prepareArticles(
        request.link,
        caption,
        videoTitle,
        storeName,
      );

      if (articleDtos.length === 0) {
        await this.sendNotification(
          `Article 생성 실패로 건너뜀\n**URL:** ${request.link}`,
          true,
        );
        await this.updateStatus(request.id, "skipped", "Article 생성 실패");
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
      const articlesCreated = await this.articleService.saveArticles(
        articleDtos,
        videoTitle,
      );

      console.log(
        `[ManualUrlProcessor]   - 수동 요청 처리 완료: ${videoTitle} (${articlesCreated}개 Article)`,
      );
      await this.sendNotification(
        `수동 URL 처리 완료\n**제목:** ${videoTitle}\n**Article:** ${articlesCreated}개\n**URL:** ${request.link}`,
      );

      // 6. youtube_request 상태를 completed로 업데이트
      await this.updateStatus(
        request.id,
        "completed",
        `처리 완료: ${articlesCreated}개 Article 생성`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.updateStatus(request.id, "failed", errorMessage);
      throw error;
    }
  }

  private async findUnprocessedUrls(): Promise<YoutubeRequestEntity[]> {
    try {
      // skipped/failed는 자동 재시도 안 함 (사용자가 pending으로 변경 시 재처리)
      return await this.youtubeRequestRepository.find({
        where: [{ processStatus: "pending" }, { processStatus: "processing" }],
        order: { createdAt: "ASC" },
      });
    } catch (error) {
      console.error("[ManualUrlProcessor] 미처리 수동 URL 조회 실패:", error);
      await this.sendNotification(
        `미처리 수동 URL 조회 실패\n**에러:** ${
          error instanceof Error ? error.message : String(error)
        }`,
        true,
      );
      return [];
    }
  }

  private async updateStatus(
    requestId: number,
    status: ProcessStatus,
    message?: string,
  ): Promise<void> {
    try {
      await this.youtubeRequestRepository.update(requestId, {
        processStatus: status,
        processMessage: message || null,
        processedAt: new Date(),
      });
    } catch (error) {
      console.error("[ManualUrlProcessor] 요청 상태 업데이트 실패:", error);
    }
  }

  private extractVideoId(url: string): string {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
    return match ? match[1] : "";
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendNotification(
    message: string,
    isError = false,
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
