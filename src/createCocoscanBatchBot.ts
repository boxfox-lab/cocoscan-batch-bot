import {
  CocoscanBatchService,
  CocoscanService,
  CocoscanYoutubeService,
} from "./module/cocoscan";
import { startJob } from "./util/startJob";

export function createCocoscanBatchBot() {
  const batchService = new CocoscanBatchService();
  const youtubeService = new CocoscanYoutubeService();
  const cocoscanService = new CocoscanService(batchService, youtubeService);

  return async function start() {
    await startJob(
      "cocoscan batch bot",
      () => cocoscanService.process(),
      60000 * 60, // 1시간마다 체크 (시간 조건 확인용)
    );
  };
}
