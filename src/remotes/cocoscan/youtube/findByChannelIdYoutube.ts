import { cocoscanRequester } from './cocoscanRequester';
import { YoutubeEntity } from './types';

export async function findByChannelIdYoutube(
  channelId: string,
  page = 1,
  limit = 20,
): Promise<{ videos: YoutubeEntity[]; total: number }> {
  const response = await cocoscanRequester.get<{
    videos: YoutubeEntity[];
    total: number;
  }>(`/youtube/channel/${channelId}`, {
    params: { page, limit },
  });
  return response.data;
}
