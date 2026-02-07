import { AnalyzedProduct } from './agents/analysis-agent';

/**
 * 자막에서 분류된 주제 그룹
 */
export interface TopicGroup {
  /** 주제 고유 ID */
  topicId: string;
  /** 주제 제목 (예: "이번 주 할인 식품 BEST 5") */
  topicTitle: string;
  /** 카테고리 (예: "식품", "생활용품", "신상품" 등) */
  category: string;
  /** 해당 주제 관련 자막 부분 */
  relevantContent: string;
  /** 관련 상품명 목록 */
  products: string[];
}

/**
 * 주제 분류 결과
 */
export interface TopicSplitResult {
  /** 분류된 주제 그룹들 */
  topics: TopicGroup[];
  /** 전체 영상의 간단한 요약 */
  overallSummary: string;
}

/**
 * 생성된 Article (API 전송 전 내부 사용)
 */
export interface GeneratedArticle {
  /** 주제 제목 */
  topicTitle: string;
  /** 카테고리 */
  category: string;
  /** SEO 최적화 제목 */
  title: string;
  /** 마크다운 본문 */
  content: string;
  /** 3줄 요약 */
  summary: string;
  /** 분석된 상품 정보 */
  products: AnalyzedProduct[];
  /** SEO 키워드 */
  keywords: string[];
}
