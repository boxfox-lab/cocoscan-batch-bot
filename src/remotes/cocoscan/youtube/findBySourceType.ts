import { cocoscanRequester } from './cocoscanRequester';
import { YoutubeEntity, SourceType } from './types';

/**
 * sourceType으로 유튜브 컨텐츠 조회
 */
export async function findBySourceType(
  sourceType: SourceType,
): Promise<YoutubeEntity[]> {
  const response = await cocoscanRequester.get<YoutubeEntity[]>(
    `/youtube?sourceType=${sourceType}`,
  );
  return response.data;
}
