import { CostcoSummaryService } from './costco-summary.service';
import { TopicSplitterAgent } from './agents/topic-splitter-agent';
import { AnalysisAgent } from './agents/analysis-agent';
import { CopywriterAgent } from './agents/copywriter-agent';
import { ProofreaderAgent } from './agents/proofreader-agent';
import { sendDiscordMessage } from '../../remotes/discord/sendDiscordMessage';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';

jest.mock('./agents/topic-splitter-agent');
jest.mock('./agents/analysis-agent');
jest.mock('./agents/copywriter-agent');
jest.mock('./agents/proofreader-agent');
jest.mock('../../remotes/discord/sendDiscordMessage');
jest.mock('../../util/error/global-error-handler');

describe('CostcoSummaryService', () => {
  let service: CostcoSummaryService;
  let mockTopicSplitter: jest.Mocked<TopicSplitterAgent>;
  let mockAnalysis: jest.Mocked<AnalysisAgent>;
  let mockCopywriter: jest.Mocked<CopywriterAgent>;
  let mockProofreader: jest.Mocked<ProofreaderAgent>;

  beforeEach(() => {
    service = new CostcoSummaryService();
    mockTopicSplitter = (service as any).topicSplitterAgent;
    mockAnalysis = (service as any).analysisAgent;
    mockCopywriter = (service as any).copywriterAgent;
    mockProofreader = (service as any).proofreaderAgent;

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateArticles', () => {
    describe('성공 케이스', () => {
      it('전체 파이프라인이 정상 동작하여 Article을 생성해야 한다', async () => {
        // Arrange
        const rawData = 'test raw subtitle data';
        const videoTitle = '코스트코 신상품 소개';
        const storeName = '코스트코';
        const webhookUrl = 'https://discord.com/webhook/test';

        mockTopicSplitter.split.mockResolvedValue({
          topics: [
            {
              topicTitle: '신선식품',
              category: 'food',
              content: '신선한 과일과 채소',
            } as any,
          ],
          overallSummary: '코스트코 신상품 전체 요약',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [
            { name: '딸기', price: '15,000원', description: '신선한 딸기' } as any,
          ],
          keywords: ['딸기', '신선식품', '코스트코'],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: '코스트코 신선식품 추천',
          content: '딸기가 정말 신선합니다.',
          summary: '코스트코 딸기 추천',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: '코스트코 신선식품 추천 - 최종',
          content: '딸기가 정말 신선합니다 (교정 완료)',
          summary: '코스트코 딸기 추천 (교정 완료)',
        });

        // Act
        const result = await service.generateArticles(
          rawData,
          videoTitle,
          storeName,
          webhookUrl,
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          topicTitle: '신선식품',
          category: 'food',
          title: '코스트코 신선식품 추천 - 최종',
          content: '딸기가 정말 신선합니다 (교정 완료)',
          summary: '코스트코 딸기 추천 (교정 완료)',
          products: [
            { name: '딸기', price: '15,000원', description: '신선한 딸기' },
          ],
          keywords: ['딸기', '신선식품', '코스트코'],
        });

        expect(mockTopicSplitter.split).toHaveBeenCalledWith(
          rawData,
          videoTitle,
          storeName,
        );
        expect(mockAnalysis.analyzeTopicGroup).toHaveBeenCalledTimes(1);
        expect(mockCopywriter.writeForTopic).toHaveBeenCalledTimes(1);
        expect(mockProofreader.proofreadArticle).toHaveBeenCalledTimes(1);
        expect(sendDiscordMessage).toHaveBeenCalled();
      });

      it('여러 주제를 처리하여 여러 Article을 생성해야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [
            { topicTitle: 'Topic 1', category: 'cat1', content: 'content1' } as any,
            { topicTitle: 'Topic 2', category: 'cat2', content: 'content2' } as any,
            { topicTitle: 'Topic 3', category: 'cat3', content: 'content3' } as any,
          ],
          overallSummary: 'Overall Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Draft',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final Content',
          summary: 'Final Summary',
        });

        // Act
        const result = await service.generateArticles('raw data');

        // Assert
        expect(result).toHaveLength(3);
        expect(mockTopicSplitter.split).toHaveBeenCalledTimes(1);
        expect(mockAnalysis.analyzeTopicGroup).toHaveBeenCalledTimes(3);
        expect(mockCopywriter.writeForTopic).toHaveBeenCalledTimes(3);
        expect(mockProofreader.proofreadArticle).toHaveBeenCalledTimes(3);
      });

      it('videoTitle과 storeName을 각 에이전트에 전달해야 한다', async () => {
        // Arrange
        const rawData = 'test data';
        const videoTitle = '이마트 트레이더스 추천';
        const storeName = '이마트 트레이더스';

        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        await service.generateArticles(rawData, videoTitle, storeName);

        // Assert
        expect(mockTopicSplitter.split).toHaveBeenCalledWith(
          rawData,
          videoTitle,
          storeName,
        );
        expect(mockCopywriter.writeForTopic).toHaveBeenCalledWith(
          expect.anything(),
          videoTitle,
          storeName,
        );
        expect(mockAnalysis.analyzeTopicGroup).toHaveBeenCalledWith(
          expect.anything(),
          storeName,
        );
        expect(mockProofreader.proofreadArticle).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          storeName,
        );
      });

      it('webhookUrl이 없으면 디스코드 알림을 보내지 않아야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        await service.generateArticles('raw data', undefined, '코스트코', undefined);

        // Assert
        expect(sendDiscordMessage).not.toHaveBeenCalled();
      });

      it('생성된 Article이 없으면 디스코드 알림을 보내지 않아야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [],
          overallSummary: 'No topics',
        });

        // Act
        await service.generateArticles('raw data', undefined, '코스트코', 'webhook-url');

        // Assert
        expect(sendDiscordMessage).not.toHaveBeenCalled();
      });
    });

    describe('에러 케이스', () => {
      it('개별 주제 처리 실패 시 에러를 로깅하고 다음 주제를 계속 처리해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        mockTopicSplitter.split.mockResolvedValue({
          topics: [
            { topicTitle: 'Topic 1', category: 'cat1' } as any,
            { topicTitle: 'Topic 2', category: 'cat2' } as any,
            { topicTitle: 'Topic 3', category: 'cat3' } as any,
          ],
          overallSummary: 'Overall Summary',
        });

        // Topic 1 실패, Topic 2 성공, Topic 3 성공
        mockAnalysis.analyzeTopicGroup
          .mockRejectedValueOnce(new Error('Analysis failed for Topic 1'))
          .mockResolvedValueOnce({ products: [], keywords: [] } as any)
          .mockResolvedValueOnce({ products: [], keywords: [] } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Success',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final Success',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        const result = await service.generateArticles('raw data');

        // Assert
        expect(result).toHaveLength(2); // Topic 2, Topic 3만 성공
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('주제 처리 실패: Topic 1'),
          expect.any(Error),
        );

        consoleErrorSpy.mockRestore();
      });

      it('TopicSplitterAgent 실패 시 GlobalErrorHandler를 호출하고 에러를 throw해야 한다', async () => {
        // Arrange
        const splitterError = new Error('Topic splitter failed');
        mockTopicSplitter.split.mockRejectedValue(splitterError);
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act & Assert
        await expect(
          service.generateArticles('raw data', undefined, '코스트코'),
        ).rejects.toThrow('Topic splitter failed');

        expect(GlobalErrorHandler.handleError).toHaveBeenCalledWith(
          splitterError,
          'CostcoSummaryService.generateArticles',
        );

        consoleErrorSpy.mockRestore();
      });

      it('AnalysisAgent 실패 시 해당 주제를 스킵하고 계속 진행해야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [
            { topicTitle: 'Fail Topic', category: 'cat1' } as any,
            { topicTitle: 'Success Topic', category: 'cat2' } as any,
          ],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup
          .mockRejectedValueOnce(new Error('Analysis error'))
          .mockResolvedValueOnce({ products: [], keywords: [] } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act
        const result = await service.generateArticles('raw data');

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0].topicTitle).toBe('Success Topic');

        consoleErrorSpy.mockRestore();
      });

      it('CopywriterAgent 실패 시 해당 주제를 스킵하고 계속 진행해야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [
            { topicTitle: 'Fail Topic', category: 'cat1' } as any,
            { topicTitle: 'Success Topic', category: 'cat2' } as any,
          ],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic
          .mockRejectedValueOnce(new Error('Copywriter error'))
          .mockResolvedValueOnce({
            title: 'Title',
            content: 'Content',
            summary: 'Summary',
          });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act
        const result = await service.generateArticles('raw data');

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0].topicTitle).toBe('Success Topic');

        consoleErrorSpy.mockRestore();
      });

      it('ProofreaderAgent 실패 시 해당 주제를 스킵하고 계속 진행해야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [
            { topicTitle: 'Fail Topic', category: 'cat1' } as any,
            { topicTitle: 'Success Topic', category: 'cat2' } as any,
          ],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle
          .mockRejectedValueOnce(new Error('Proofreader error'))
          .mockResolvedValueOnce({
            title: 'Final',
            content: 'Final',
            summary: 'Final',
          });

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act
        const result = await service.generateArticles('raw data');

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0].topicTitle).toBe('Success Topic');

        consoleErrorSpy.mockRestore();
      });

      it('디스코드 알림 실패 시 에러를 로깅하지만 프로세스는 계속되어야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        (sendDiscordMessage as jest.Mock).mockRejectedValue(
          new Error('Discord webhook failed'),
        );

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act
        const result = await service.generateArticles(
          'raw data',
          undefined,
          '코스트코',
          'webhook-url',
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('디스코드 알림 전송 실패'),
          expect.any(Error),
        );

        consoleErrorSpy.mockRestore();
      });
    });

    describe('경계값 테스트', () => {
      it('빈 rawData를 받으면 빈 배열을 반환해야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [],
          overallSummary: '',
        });

        // Act
        const result = await service.generateArticles('');

        // Assert
        expect(result).toEqual([]);
        expect(mockTopicSplitter.split).toHaveBeenCalledWith('', undefined, '코스트코');
      });

      it('매우 긴 rawData도 처리할 수 있어야 한다', async () => {
        // Arrange
        const longRawData = 'a'.repeat(100000);
        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        const result = await service.generateArticles(longRawData);

        // Assert
        expect(result).toHaveLength(1);
        expect(mockTopicSplitter.split).toHaveBeenCalledWith(
          longRawData,
          undefined,
          '코스트코',
        );
      });

      it('매우 긴 videoTitle도 처리할 수 있어야 한다', async () => {
        // Arrange
        const longVideoTitle = 'Very Long Title '.repeat(100);
        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        const result = await service.generateArticles('raw data', longVideoTitle);

        // Assert
        expect(result).toHaveLength(1);
        expect(mockTopicSplitter.split).toHaveBeenCalledWith(
          'raw data',
          longVideoTitle,
          '코스트코',
        );
      });

      it('매우 긴 디스코드 메시지는 1600자로 잘려야 한다', async () => {
        // Arrange
        const manyTopics = Array.from({ length: 50 }, (_, i) => ({
          topicTitle: `Topic ${i}`,
          category: `cat${i}`,
        }));

        mockTopicSplitter.split.mockResolvedValue({
          topics: manyTopics as any,
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Very Long Title That Repeats '.repeat(10),
          content: 'Content',
          summary: 'Very Long Summary That Repeats '.repeat(10),
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Very Long Final Title '.repeat(10),
          content: 'Final',
          summary: 'Very Long Final Summary '.repeat(10),
        });

        // Act
        await service.generateArticles(
          'raw data',
          undefined,
          '코스트코',
          'webhook-url',
        );

        // Assert
        expect(sendDiscordMessage).toHaveBeenCalled();
        const sentMessage = (sendDiscordMessage as jest.Mock).mock.calls[0][0];
        // 메시지에 "..."가 포함되어 있는지 확인 (1600자 제한으로 잘렸다는 표시)
        expect(sentMessage).toContain('...');
      });

      it('storeName이 기본값 "코스트코"로 설정되어야 한다', async () => {
        // Arrange
        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        await service.generateArticles('raw data');

        // Assert
        expect(mockTopicSplitter.split).toHaveBeenCalledWith(
          'raw data',
          undefined,
          '코스트코',
        );
      });

      it('특수 문자가 포함된 매장명도 처리할 수 있어야 한다', async () => {
        // Arrange
        const specialStoreName = '이마트&트레이더스 <특별점>';
        mockTopicSplitter.split.mockResolvedValue({
          topics: [{ topicTitle: 'Topic', category: 'cat' } as any],
          overallSummary: 'Summary',
        });

        mockAnalysis.analyzeTopicGroup.mockResolvedValue({
          products: [],
          keywords: [],
        } as any);

        mockCopywriter.writeForTopic.mockResolvedValue({
          title: 'Title',
          content: 'Content',
          summary: 'Summary',
        });

        mockProofreader.proofreadArticle.mockResolvedValue({
          title: 'Final',
          content: 'Final',
          summary: 'Final',
        });

        // Act
        const result = await service.generateArticles(
          'raw data',
          undefined,
          specialStoreName,
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(mockTopicSplitter.split).toHaveBeenCalledWith(
          'raw data',
          undefined,
          specialStoreName,
        );
      });
    });
  });
});
