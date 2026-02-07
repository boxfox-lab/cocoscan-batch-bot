import { cocoscanRequester } from './cocoscanRequester';
import { YoutubeEntity } from './types';

export async function findByLinkYoutube(
  link: string,
): Promise<YoutubeEntity | null> {
  try {
    const encodedLink = encodeURIComponent(link);
    const response = await cocoscanRequester.get<YoutubeEntity>(
      `/youtube/link/${encodedLink}`,
    );
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
