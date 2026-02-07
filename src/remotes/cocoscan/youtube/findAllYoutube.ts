import { cocoscanRequester } from './cocoscanRequester';
import { YoutubeEntity } from './types';

export async function findAllYoutube(
  page = 1,
  limit = 20,
): Promise<{ videos: YoutubeEntity[]; total: number }> {
  const response = await cocoscanRequester.get<{
    videos: YoutubeEntity[];
    total: number;
  }>('/youtube', {
    params: { page, limit },
  });
  return response.data;
}

