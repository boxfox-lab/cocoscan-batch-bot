import axios from 'axios';

export interface StoreSearchResult {
  title: string;
  link: string;
  snippet: string;
  source?: string;
}

export interface GoogleSearchResponse {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
    displayLink?: string;
    formattedUrl?: string;
  }>;
}

export async function searchStore(
  query: string,
  storeName: string = '코스트코',
  maxResults = 5,
): Promise<StoreSearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    console.warn(
      `[StoreSearch] GOOGLE_SEARCH_API_KEY 또는 GOOGLE_SEARCH_ENGINE_ID가 설정되지 않았습니다.`,
    );
    return [];
  }

  try {
    // 매장 관련 검색
    const searchQuery = `${query} ${storeName}`;
    const url = 'https://www.googleapis.com/customsearch/v1';

    const response = await axios.get<GoogleSearchResponse>(url, {
      params: {
        key: apiKey,
        cx: searchEngineId,
        q: searchQuery,
        num: Math.min(maxResults, 10), // 최대 10개
        safe: 'active',
        lr: 'lang_ko', // 한국어 결과만
        gl: 'kr', // 한국 지역
      },
      timeout: 10000,
    });

    if (!response.data.items || response.data.items.length === 0) {
      return [];
    }

    return response.data.items.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      source: item.displayLink || item.formattedUrl,
    }));
  } catch (error) {
    // 403 에러는 API 키 문제이거나 할당량 초과일 수 있음
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data?.error;
      const errorMessage = errorData?.message || error.message;
      const errorReason = errorData?.errors?.[0]?.reason || errorData?.reason;

      if (status === 403) {
        console.warn(`[StoreSearch] API 접근 거부 (403): ${errorMessage}`);
        if (errorReason) {
          console.warn(`[StoreSearch] 에러 원인: ${errorReason}`);
        }
        console.warn('[StoreSearch] 검색을 건너뜁니다.');
      } else {
        console.warn(
          `[StoreSearch] 검색 실패 (${
            status || 'unknown'
          }): ${errorMessage}. 검색을 건너뜁니다.`,
        );
      }
    } else {
      console.warn('[StoreSearch] 검색 실패. 검색을 건너뜁니다.');
    }
    return [];
  }
}
