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
      60000 * 10, // 10분마다 체크
    );
  };
}
