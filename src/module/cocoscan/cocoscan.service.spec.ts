import { CocoscanService } from './cocoscan.service';
import { CocoscanBatchService } from './cocoscan-batch.service';
import { CocoscanYoutubeService } from './cocoscan-youtube.service';

jest.mock('./cocoscan-batch.service');
jest.mock('./cocoscan-youtube.service');

describe('CocoscanService', () => {
  let service: CocoscanService;
  let mockBatchService: jest.Mocked<CocoscanBatchService>;
  let mockYoutubeService: jest.Mocked<CocoscanYoutubeService>;

  beforeEach(() => {
    // Arrange - Mock 인스턴스 생성
    mockBatchService = new CocoscanBatchService() as jest.Mocked<CocoscanBatchService>;
    mockYoutubeService = new CocoscanYoutubeService() as jest.Mocked<CocoscanYoutubeService>;

    mockBatchService.process = jest.fn().mockResolvedValue(undefined);
    mockYoutubeService.process = jest.fn().mockResolvedValue(undefined);

    service = new CocoscanService(mockBatchService, mockYoutubeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process', () => {
    it('배치 서비스와 유튜브 서비스를 병렬로 실행해야 한다', async () => {
      // Arrange - mocks already set in beforeEach

      // Act
      await service.process();

      // Assert
      expect(mockBatchService.process).toHaveBeenCalledTimes(1);
      expect(mockYoutubeService.process).toHaveBeenCalledTimes(1);
    });

    it('배치 서비스 실패 시 에러를 throw해야 한다', async () => {
      // Arrange
      const batchError = new Error('Batch service failed');
      mockBatchService.process = jest.fn().mockRejectedValue(batchError);

      // Act & Assert
      await expect(service.process()).rejects.toThrow('Batch service failed');
      expect(mockBatchService.process).toHaveBeenCalledTimes(1);
    });

    it('유튜브 서비스 실패 시 에러를 throw해야 한다', async () => {
      // Arrange
      const youtubeError = new Error('Youtube service failed');
      mockYoutubeService.process = jest.fn().mockRejectedValue(youtubeError);

      // Act & Assert
      await expect(service.process()).rejects.toThrow('Youtube service failed');
      expect(mockYoutubeService.process).toHaveBeenCalledTimes(1);
    });

    it('두 서비스 모두 실패 시 첫 번째 에러를 throw해야 한다 (Promise.all 동작)', async () => {
      // Arrange
      const batchError = new Error('Batch failed');
      const youtubeError = new Error('Youtube failed');
      mockBatchService.process = jest.fn().mockRejectedValue(batchError);
      mockYoutubeService.process = jest.fn().mockRejectedValue(youtubeError);

      // Act & Assert
      await expect(service.process()).rejects.toThrow();
      // Promise.all은 첫 번째 reject를 throw하므로 batchError 또는 youtubeError 중 하나
    });

    it('배치 서비스와 유튜브 서비스가 병렬로 실행되어야 한다 (타이밍 검증)', async () => {
      // Arrange
      let batchStartTime: number;
      let youtubeStartTime: number;
      const delay = 50;

      mockBatchService.process = jest.fn().mockImplementation(async () => {
        batchStartTime = Date.now();
        await new Promise((resolve) => setTimeout(resolve, delay));
      });

      mockYoutubeService.process = jest.fn().mockImplementation(async () => {
        youtubeStartTime = Date.now();
        await new Promise((resolve) => setTimeout(resolve, delay));
      });

      // Act
      const startTime = Date.now();
      await service.process();
      const endTime = Date.now();

      // Assert - 병렬 실행이므로 총 소요 시간은 delay보다 약간 크고, 2*delay보다 작아야 함
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(delay * 2);
      expect(totalTime).toBeGreaterThanOrEqual(delay);
    });
  });
});
