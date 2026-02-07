import { AnalysisAgent } from './agents/analysis-agent';
import { CopywriterAgent } from './agents/copywriter-agent';
import { ProofreaderAgent } from './agents/proofreader-agent';
import { TopicSplitterAgent } from './agents/topic-splitter-agent';
import { sendDiscordMessage } from '../../remotes/discord/sendDiscordMessage';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';
import { GeneratedArticle } from './types';

/**
 * 코스트코 및 이마트 트레이더스 상품 정보를 분석하여 주제별 Article을 생성하는 서비스입니다.
 * 이 서비스는 코스트코(Costco)와 이마트 트레이더스(Emart Traders) 두 매장 모두를 지원합니다.
 */
export class CostcoSummaryService {
  private readonly topicSplitterAgent: TopicSplitterAgent;
  private readonly analysisAgent: AnalysisAgent;
  private readonly copywriterAgent: CopywriterAgent;
  private readonly proofreaderAgent: ProofreaderAgent;

  constructor() {
    this.topicSplitterAgent = new TopicSplitterAgent();
    this.analysisAgent = new AnalysisAgent();
    this.copywriterAgent = new CopywriterAgent();
    this.proofreaderAgent = new ProofreaderAgent();
  }

  /**
   * 자막 데이터를 분석하여 주제별 Article 배열을 생성합니다
   * @param rawData 유튜브 자막 원본
   * @param videoTitle 원본 영상 제목 (SEO 키워드 참고용)
   * @param storeName 매장 브랜드명 (예: '코스트코', '이마트 트레이더스')
   * @param webhookUrl 디스코드 알림 웹훅 URL
   */
  async generateArticles(
    rawData: string,
    videoTitle?: string,
    storeName: string = '코스트코',
    webhookUrl?: string,
  ): Promise<GeneratedArticle[]> {
    try {
      console.log(
        `[${storeName}Summary] Article 생성 프로세스 시작 (${storeName})...`,
      );

      // 1. 주제 분류 단계 (영상 제목을 힌트로 전달)
      const topicSplitResult = await this.topicSplitterAgent.split(
        rawData,
        videoTitle,
        storeName,
      );
      console.log(
        `[${storeName}Summary] ${topicSplitResult.topics.length}개 주제 분류 완료`,
      );

      // 2. 각 주제별로 분석 → 작성 → 교정 파이프라인 실행
      const articles: GeneratedArticle[] = [];

      for (const topic of topicSplitResult.topics) {
        try {
          console.log(
            `[${storeName}Summary] 주제 처리 중: ${topic.topicTitle}`,
          );

          // 2-1. 분석 단계
          const topicAnalysis = await this.analysisAgent.analyzeTopicGroup(
            topic,
            storeName,
          );

          // 2-2. 작성 단계 (영상 제목을 SEO 참고용으로 전달)
          const draft = await this.copywriterAgent.writeForTopic(
            topicAnalysis,
            videoTitle,
            storeName,
          );

          // 2-3. 교정 단계
          const finalDraft = await this.proofreaderAgent.proofreadArticle(
            draft,
            topicAnalysis,
            storeName,
          );

          // GeneratedArticle 생성
          const article: GeneratedArticle = {
            topicTitle: topic.topicTitle,
            category: topic.category,
            title: finalDraft.title,
            content: finalDraft.content,
            summary: finalDraft.summary,
            products: topicAnalysis.products,
            keywords: topicAnalysis.keywords,
          };

          articles.push(article);
          console.log(`[${storeName}Summary] 주제 완료: ${topic.topicTitle}`);
        } catch (topicError) {
          console.error(
            `[${storeName}Summary] 주제 처리 실패: ${topic.topicTitle}`,
            topicError,
          );
          // 개별 주제 실패 시 계속 진행
        }
      }

      console.log(
        `[${storeName}Summary] Article 생성 완료: ${articles.length}개`,
      );

      // 디스코드 알림
      if (webhookUrl && articles.length > 0) {
        await this.notifyArticlesToDiscord(webhookUrl, articles, storeName);
      }

      return articles;
    } catch (error) {
      console.error(`[${storeName}Summary] 프로세스 중 오류 발생:`, error);
      await GlobalErrorHandler.handleError(
        error as Error,
        'CostcoSummaryService.generateArticles',
      );
      throw error;
    }
  }

  private async notifyArticlesToDiscord(
    webhookUrl: string,
    articles: GeneratedArticle[],
    storeName: string = '코스트코',
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const articleSummaries = articles
        .map((a, i) => `**${i + 1}. ${a.title}** (${a.category})\n${a.summary}`)
        .join('\n\n');

      const message = `🛒 **${storeName} Article 생성 완료** (${
        articles.length
      }개)\n\n${articleSummaries.substring(0, 1600)}${
        articleSummaries.length > 1600 ? '...' : ''
      }\n\n**생성 시간:** ${timestamp}`;
      await sendDiscordMessage(message, webhookUrl);
    } catch (error) {
      console.error(`[${storeName}Summary] 디스코드 알림 전송 실패:`, error);
    }
  }
}
