import { AnalyzedProduct } from '../../../module/costco-summary/agents/analysis-agent';

export interface CreateArticleDto {
  youtubeLink: string;
  topicTitle?: string;
  category?: string;
  title?: string;
  content?: string;
  summary?: string;
  keywords?: string[];
  products?: AnalyzedProduct[];
}

export interface ArticleEntity {
  id: string;
  youtubeLink: string;
  topicTitle?: string;
  category?: string;
  title?: string;
  content?: string;
  summary?: string;
  keywords?: string[];
  products?: AnalyzedProduct[];
  createdAt: string;
  updatedAt: string;
}
