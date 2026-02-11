import axios from "axios";
import { isQuotaExceededError, QuotaExceededError } from "./errors";

export interface YouTubeVideoResponse {
  items: Array<{
    id: string;
    snippet: {
      publishedAt: string;
      channelId: string;
      title: string;
      description: string;
      thumbnails: {
        default?: { url: string };
        medium?: { url: string };
        high?: { url: string };
      };
      channelTitle: string;
    };
  }>;
}

export async function getVideoDetails(
  videoId: string,
  apiKey: string,
): Promise<YouTubeVideoResponse | null> {
  try {
    const response = await axios.get<YouTubeVideoResponse>(
      "https://www.googleapis.com/youtube/v3/videos",
      {
        params: {
          part: "snippet",
          id: videoId,
          key: apiKey,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw new QuotaExceededError(apiKey);
    }
    console.error(`[YouTube API] 비디오 정보 조회 실패 (${videoId}):`, error);
    return null;
  }
}
