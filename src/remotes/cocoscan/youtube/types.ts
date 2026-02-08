export type ChannelType = 'costco' | 'emart_traders';
export type SourceType = 'auto' | 'manual';

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
  id: number;
  link: string;
  channelName: string;
  channelId: string;
  channelType?: ChannelType;
  sourceType?: SourceType;
  title?: string;
  snippet?: string;
  publishedAt: string; // ISO date string
  content?: string;
  thumbnail?: string;
  createdAt: string; // ISO date string
  summary?: string;
}
