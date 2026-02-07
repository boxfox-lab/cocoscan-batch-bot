import { CocoscanBatchService } from './cocoscan-batch.service';
import { CocoscanYoutubeService } from './cocoscan-youtube.service';

export class CocoscanService {
  constructor(
    private readonly batchService: CocoscanBatchService,
    private readonly youtubeService: CocoscanYoutubeService,
  ) {}

  async process() {
    // 배치 작업과 유튜브 작업을 병렬로 실행
    await Promise.all([
      this.batchService.process(),
      this.youtubeService.process(),
    ]);
  }
}
