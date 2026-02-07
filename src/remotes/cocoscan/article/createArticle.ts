import { cocoscanRequester } from '../youtube/cocoscanRequester';
import { CreateArticleDto, ArticleEntity } from './types';

export async function createArticle(
  dto: CreateArticleDto,
): Promise<ArticleEntity> {
  const response = await cocoscanRequester.post<ArticleEntity>('/article', dto);
  return response.data;
}

export async function createManyArticle(
  dtos: CreateArticleDto[],
): Promise<{ created: number; articles: ArticleEntity[] }> {
  const response = await cocoscanRequester.post<{
    created: number;
    articles: ArticleEntity[];
  }>('/article/batch', dtos);
  return response.data;
}
