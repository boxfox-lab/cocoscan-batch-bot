import axios from 'axios';
import { CocoscanBatchService } from './cocoscan-batch.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CocoscanBatchService', () => {
  let service: CocoscanBatchService;

  beforeEach(() => {
    service = new CocoscanBatchService();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not run if current hour is not in allowed range (9-20)', async () => {
    // Set time to 8 AM local
    jest.setSystemTime(new Date('2026-02-06T08:00:00'));

    await service.process();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('should not run if current hour is not one of allowed hours (9, 13, 17)', async () => {
    // Set time to 10 AM local (within 9-20 but not in allowedHours)
    jest.setSystemTime(new Date('2026-02-06T10:00:00'));

    await service.process();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('should run if current hour is 9 AM', async () => {
    jest.setSystemTime(new Date('2026-02-06T09:00:00')); // Local time
    mockedAxios.post.mockResolvedValue({ status: 200 });

    await service.process();
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('should not run again if 4 hours have not passed', async () => {
    // First run at 9 AM
    jest.setSystemTime(new Date('2026-02-06T09:00:00'));
    mockedAxios.post.mockResolvedValue({ status: 200 });
    await service.process();
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    mockedAxios.post.mockClear();

    // Try to run at 10 AM (even if we changed allowedHours, it should still check lastExecutionTime)
    // Wait, the logic says if hour is not 13, it will return anyway.
    // Let's test if it skips at 13:00 if it ran too recently (though it shouldn't happen with 9, 13, 17)

    jest.setSystemTime(new Date('2026-02-06T13:00:00'));
    // Manually set lastExecutionTime to 10 AM (3 hours ago)
    (service as any).lastExecutionTime = new Date('2026-02-06T10:00:00');

    await service.process();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully and continue', async () => {
    jest.setSystemTime(new Date('2026-02-06T09:00:00'));
    mockedAxios.post
      .mockRejectedValueOnce(new Error('API 1 Fail'))
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 200 });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    await service.process();

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('API 1 error'),
      'API 1 Fail',
    );

    consoleErrorSpy.mockRestore();
  });
});
