import { CostcoSummaryService } from './costco-summary.service';
import { TopicSplitterAgent } from './agents/topic-splitter-agent';
import { AnalysisAgent } from './agents/analysis-agent';
import { CopywriterAgent } from './agents/copywriter-agent';
import { ProofreaderAgent } from './agents/proofreader-agent';
import { sendDiscordMessage } from '../../remotes/discord/sendDiscordMessage';

jest.mock('./agents/topic-splitter-agent');
jest.mock('./agents/analysis-agent');
jest.mock('./agents/copywriter-agent');
jest.mock('./agents/proofreader-agent');
jest.mock('../../remotes/discord/sendDiscordMessage');

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
  });

  describe('generateArticles', () => {
    it('should process the pipeline successfully', async () => {
      mockTopicSplitter.split.mockResolvedValue({
        topics: [
          {
            topicTitle: 'Topic 1',
            category: 'Category 1',
            content: 'Content 1',
          } as any,
        ],
        overallSummary: 'Overall Summary',
      });
      mockAnalysis.analyzeTopicGroup.mockResolvedValue({
        products: [{ name: 'Product 1' } as any],
        keywords: ['keyword1'],
      } as any);
      mockCopywriter.writeForTopic.mockResolvedValue({
        title: 'Draft Title',
        content: 'Draft Content',
        summary: 'Draft Summary',
      });
      mockProofreader.proofreadArticle.mockResolvedValue({
        title: 'Final Title',
        content: 'Final Content',
        summary: 'Final Summary',
      });

      const result = await service.generateArticles(
        'raw data',
        'video title',
        '코스트코',
        'webhook-url',
      );

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Final Title');
      expect(mockTopicSplitter.split).toHaveBeenCalled();
      expect(sendDiscordMessage).toHaveBeenCalled();
    });

    it('should handle individual topic errors and continue', async () => {
      mockTopicSplitter.split.mockResolvedValue({
        topics: [
          { topicTitle: 'Topic 1', category: 'Category 1' } as any,
          { topicTitle: 'Topic 2', category: 'Category 2' } as any,
        ],
        overallSummary: 'Overall Summary',
      });

      mockAnalysis.analyzeTopicGroup
        .mockRejectedValueOnce(new Error('Analysis failed'))
        .mockResolvedValueOnce({ products: [], keywords: [] } as any);

      mockCopywriter.writeForTopic.mockResolvedValue({
        title: '',
        content: '',
        summary: '',
      });
      mockProofreader.proofreadArticle.mockResolvedValue({
        title: 'Success',
        content: '',
        summary: '',
      });

      const result = await service.generateArticles('raw data');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Success');
    });
  });
});
