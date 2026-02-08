import { cocoscanRequester } from '../youtube/cocoscanRequester';
import { ArticleEntity } from './types';

/**
 * youtubeLink로 Article 조회
 */
export async function findArticlesByYoutubeLink(
  youtubeLink: string,
): Promise<ArticleEntity[]> {
  const response = await cocoscanRequester.get<{ data: ArticleEntity[] }>(
    `/article?youtubeLink=${encodeURIComponent(youtubeLink)}`,
  );
  return response.data.data;
}
