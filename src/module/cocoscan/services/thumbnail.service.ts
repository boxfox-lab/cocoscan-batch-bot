import axios from "axios";

export interface ThumbnailResult {
  imageUrl: string;
  source: string;
  altText: string;
}

/**
 * batch-bot 카테고리 → Unsplash 영어 검색 쿼리 매핑
 * auto-report-bot run.sh:202-213 참고 + batch-bot 카테고리 확장
 */
const CATEGORY_QUERY_MAP: Record<string, string> = {
  식품: "fresh food grocery",
  생활용품: "household items shopping",
  "가전/전자": "electronics appliances store",
  "의류/패션": "clothing fashion shopping",
  "건강/뷰티": "health beauty products",
  할인정보: "shopping sale discount store",
  신상품: "new grocery product food",
  매장정보: "warehouse retail store interior",
};

const GENERIC_QUERY = "grocery store shopping costco";

export class ThumbnailService {
  private readonly unsplashAccessKey: string | undefined;

  constructor() {
    this.unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!this.unsplashAccessKey) {
      console.warn(
        "[ThumbnailService] UNSPLASH_ACCESS_KEY 미설정 - Article 썸네일은 YouTube 썸네일로 fallback됩니다",
      );
    }
  }

  /**
   * 같은 영상에서 나온 여러 Article에 대해 중복 없는 썸네일을 할당합니다.
   *
   * @param articles 카테고리/제목/키워드 정보 배열
   * @returns index → ThumbnailResult 맵 (일부 실패 시 해당 index 누락)
   */
  async findThumbnailsForBatch(
    articles: Array<{ category: string; title: string; keywords: string[] }>,
  ): Promise<Map<number, ThumbnailResult>> {
    const results = new Map<number, ThumbnailResult>();

    if (!this.unsplashAccessKey) {
      return results;
    }

    const usedUrls = new Set<string>();

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      try {
        const thumbnail = await this.findThumbnail(
          article.category,
          article.keywords,
          usedUrls,
        );
        if (thumbnail) {
          results.set(i, thumbnail);
          usedUrls.add(thumbnail.imageUrl);
        }
      } catch (error) {
        console.error(
          `[ThumbnailService] Article ${i} 썸네일 조회 실패:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log(
      `[ThumbnailService] ${results.size}/${articles.length}개 Article 썸네일 조회 완료`,
    );
    return results;
  }

  /**
   * 단일 Article에 대한 썸네일 검색
   * 1. 카테고리 + 키워드 기반 Unsplash 검색
   * 2. generic fallback 검색
   */
  private async findThumbnail(
    category: string,
    keywords: string[],
    usedUrls: Set<string>,
  ): Promise<ThumbnailResult | null> {
    // 1차: 카테고리 + 키워드 기반 검색
    const specificQuery = this.buildQuery(category, keywords);
    const specificResults = await this.searchUnsplash(specificQuery, 10);
    const unused = specificResults.find((r) => !usedUrls.has(r.imageUrl));
    if (unused) return unused;

    // 2차: generic fallback
    const genericResults = await this.searchUnsplash(GENERIC_QUERY, 10);
    const unusedGeneric = genericResults.find(
      (r) => !usedUrls.has(r.imageUrl),
    );
    if (unusedGeneric) return unusedGeneric;

    return null;
  }

  /**
   * 카테고리 매핑 + 첫 번째 키워드로 다양성 확보
   */
  private buildQuery(category: string, keywords: string[]): string {
    const baseQuery = CATEGORY_QUERY_MAP[category] || GENERIC_QUERY;
    if (keywords.length > 0) {
      return `${baseQuery} ${keywords[0]}`;
    }
    return baseQuery;
  }

  private async searchUnsplash(
    query: string,
    perPage: number = 10,
  ): Promise<ThumbnailResult[]> {
    if (!this.unsplashAccessKey) return [];

    try {
      const response = await axios.get(
        "https://api.unsplash.com/search/photos",
        {
          params: {
            query,
            orientation: "landscape",
            per_page: perPage,
          },
          headers: {
            Authorization: `Client-ID ${this.unsplashAccessKey}`,
          },
          timeout: 10_000,
        },
      );

      return (response.data.results || [])
        .map((item: any) => ({
          imageUrl: item.urls?.regular || "",
          source: "unsplash.com",
          altText: item.alt_description || item.description || query,
        }))
        .filter((r: ThumbnailResult) => r.imageUrl !== "");
    } catch (error) {
      console.error(
        `[ThumbnailService] Unsplash 검색 실패 (query: "${query}"):`,
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }
}
