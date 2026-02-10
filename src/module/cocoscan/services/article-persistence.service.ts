import { Repository } from "typeorm";
import { AppDataSource } from "../../../database/data-source";
import { ArticleEntity } from "../../../entity/article.entity";
import { sendDiscordMessage } from "../../../remotes/discord/sendDiscordMessage";
import { GlobalErrorHandler } from "../../../util/error/global-error-handler";
import { CostcoSummaryService } from "../../costco-summary";

const COCOSCAN_DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO";

export interface CreateArticleDto {
  youtubeLink: string;
  topicTitle: string;
  category: string;
  title: string;
  content: string;
  summary: string;
  keywords: string[];
  products: any[];
}

export class ArticlePersistenceService {
  private readonly costcoSummaryService: CostcoSummaryService;
  private readonly articleRepository: Repository<ArticleEntity>;

  constructor() {
    this.costcoSummaryService = new CostcoSummaryService();
    this.articleRepository = AppDataSource.getRepository(ArticleEntity);
  }

  /**
   * 자막을 분석하여 Article DTO를 준비합니다 (저장하지 않음)
   */
  async prepareArticles(
    videoLink: string,
    caption: string,
    videoTitle?: string,
    storeName: string = "코스트코",
  ): Promise<CreateArticleDto[]> {
    try {
      await this.sendNotification(
        `AI 요약 시작\n**제목:** ${
          videoTitle ?? "(없음)"
        }\n**매장:** ${storeName}`,
      );

      const generatedArticles =
        await this.costcoSummaryService.generateArticles(
          caption,
          videoTitle,
          storeName,
        );

      if (generatedArticles.length === 0) {
        await this.sendNotification(
          `AI 요약 완료 (생성된 Article 없음)\n**제목:** ${
            videoTitle ?? "(없음)"
          }`,
        );
        console.log("[ArticlePersistence] 생성된 Article이 없습니다.");
        return [];
      }

      await this.sendNotification(
        `AI 요약 완료\n**제목:** ${videoTitle ?? "(없음)"}\n**생성 주제:** ${
          generatedArticles.length
        }개`,
      );

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
        }),
      );

      console.log(
        `[ArticlePersistence] ${articleDtos.length}개 Article 준비 완료 (저장 대기 중)`,
      );
      return articleDtos;
    } catch (error) {
      const errorMessage = `AI 요약 실패\n**제목:** ${
        videoTitle ?? "(없음)"
      }\n**에러:** ${error instanceof Error ? error.message : String(error)}`;
      console.error("[ArticlePersistence] Article 생성 실패:", error);
      await this.sendNotification(errorMessage, true);
      await GlobalErrorHandler.handleError(
        error as Error,
        "ArticlePersistenceService.prepareArticles",
        { videoLink, videoTitle },
      );
      throw error;
    }
  }

  /**
   * 준비된 Article DTO들을 DB에 저장합니다
   */
  async saveArticles(
    articleDtos: CreateArticleDto[],
    videoTitle?: string,
  ): Promise<number> {
    try {
      const articles = articleDtos.map((dto) =>
        this.articleRepository.create(dto),
      );
      const saved = await this.articleRepository.save(articles);

      console.log(`[ArticlePersistence] ${saved.length}개 Article 저장 완료`);
      await this.sendNotification(
        `Article 저장 완료\n**제목:** ${videoTitle ?? "(없음)"}\n**저장:** ${
          saved.length
        }개`,
      );
      return saved.length;
    } catch (error) {
      const errorMessage = `Article 저장 실패\n**제목:** ${
        videoTitle ?? "(없음)"
      }\n**개수:** ${articleDtos.length}개\n**에러:** ${
        error instanceof Error ? error.message : String(error)
      }`;
      console.error("[ArticlePersistence] Article 저장 실패:", error);
      await this.sendNotification(errorMessage, true);
      await GlobalErrorHandler.handleError(
        error as Error,
        "ArticlePersistenceService.saveArticles",
        { articleCount: articleDtos.length, videoTitle },
      );
      throw error;
    }
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
