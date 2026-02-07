import axios from 'axios';
import { differenceInHours } from 'date-fns';

export class CocoscanBatchService {
  private lastExecutionTime: Date | null = null;

  private readonly API_ENDPOINTS = [
    'https://api2.bake-now.com/cocoscan/admin/costco-scraping/sync-stores',
    'https://api2.bake-now.com/cocoscan/scraping/cocodal/scrape-all',
    'https://api2.bake-now.com/cocoscan/scraping/cocohalinma/discounts',
  ];

  async process() {
    const now = new Date();
    const currentHour = now.getHours();

    // 오전 9시 ~ 오후 8시 사이인지 확인
    if (currentHour < 9 || currentHour >= 20) {
      return;
    }

    // 마지막 실행 시간이 없거나 4시간 이상 지났는지 확인
    if (
      this.lastExecutionTime &&
      differenceInHours(now, this.lastExecutionTime) < 4
    ) {
      return;
    }

    // 4시간 간격으로 실행되는 시간대인지 확인 (9시, 13시, 17시)
    const allowedHours = [9, 13, 17];
    if (!allowedHours.includes(currentHour)) {
      return;
    }

    try {
      console.log(
        `[Cocoscan Batch] Starting API requests at ${now.toISOString()}`,
      );

      // 3개의 API를 순차적으로 호출
      await Promise.all(
        this.API_ENDPOINTS.map(async (endpoint, index) => {
          try {
            const response = await axios.post(endpoint);
            console.log(
              `[Cocoscan Batch] API ${index + 1} success: ${endpoint}`,
              response.status,
            );
          } catch (error) {
            console.error(
              `[Cocoscan Batch] API ${index + 1} error: ${endpoint}`,
              error instanceof Error ? error.message : error,
            );
            // 에러가 발생해도 다른 API는 계속 실행
          }
        }),
      );

      this.lastExecutionTime = now;
      console.log(
        `[Cocoscan Batch] All API requests completed at ${now.toISOString()}`,
      );
    } catch (error) {
      console.error('[Cocoscan Batch] Process error:', error);
    }
  }
}
