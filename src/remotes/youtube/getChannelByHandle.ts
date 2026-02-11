import axios from "axios";
import { sendExceptionToDiscord } from "../discord/sendExceptionToDiscord";
import { isQuotaExceededError, QuotaExceededError } from "./errors";

export interface YouTubeChannelResponse {
  kind: string;
  etag: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: Array<{
    kind: string;
    etag: string;
    id: string;
  }>;
}

export async function getChannelByHandle(
  handle: string,
  apiKey: string,
): Promise<YouTubeChannelResponse | null> {
  try {
    const response = await axios.get<YouTubeChannelResponse>(
      "https://www.googleapis.com/youtube/v3/channels",
      {
        params: {
          part: "id",
          forHandle: handle.startsWith("@") ? handle : `@${handle}`,
          key: apiKey,
        },
      },
    );

    return response.data;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw new QuotaExceededError(apiKey);
    }
    await sendExceptionToDiscord(error, {
      handle,
      apiKey: apiKey.substring(0, 10) + "...",
    });
    return null;
  }
}
