export type ChannelType = 'costco' | 'emart_traders';

export interface CreateYoutubeDto {
  link: string;
  channelName: string;
  channelId: string;
  channelType?: ChannelType;
  title?: string;
  snippet?: string;
  publishedAt: string; // ISO date string
  content?: string;
  thumbnail?: string;
  summary?: string;
}

export interface YoutubeEntity {
  link: string;
  channelName: string;
  channelId: string;
  channelType?: ChannelType;
  title?: string;
  snippet?: string;
  publishedAt: string; // ISO date string
  content?: string;
  thumbnail?: string;
  createdAt: string; // ISO date string
  summary?: string;
}
