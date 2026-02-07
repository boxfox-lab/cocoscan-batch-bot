import { cocoscanRequester } from './cocoscanRequester';
import { CreateYoutubeDto, YoutubeEntity } from './types';

export async function createYoutube(
  dto: CreateYoutubeDto,
): Promise<YoutubeEntity> {
  const response = await cocoscanRequester.post<YoutubeEntity>('/youtube', dto);
  return response.data;
}

export async function createManyYoutube(
  dtos: CreateYoutubeDto[],
): Promise<{ created: number; videos: YoutubeEntity[] }> {
  const response = await cocoscanRequester.post<{
    created: number;
    videos: YoutubeEntity[];
  }>('/youtube/batch', dtos);
  return response.data;
}

