import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  searchStore,
  StoreSearchResult,
} from '../../../remotes/cocoscan/google-search/searchStore';
import { TopicGroup } from '../types';

export interface AnalyzedProduct {
  name: string;
  price?: string;
  discountInfo?: string;
  pros?: string[];
  cons?: string[];
  additionalInfo?: string;
}

interface AnalysisResult {
  products: AnalyzedProduct[];
  summary: string;
  keywords: string[];
}

/** TopicGroup 분석 결과 (주제별 분석에 사용) */
export interface TopicAnalysisResult {
  topicId: string;
  topicTitle: string;
  category: string;
  products: AnalyzedProduct[];
  summary: string;
  keywords: string[];
}

export class AnalysisAgent {
  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    this.genAI = new GoogleGenerativeAI(key);
  }

  /**
   * TopicGroup을 분석하여 상품 정보를 추출합니다 (주제별 분석)
   * @param topic 주제 그룹
   * @param storeName 매장 브랜드명 (예: '코스트코', '이마트 트레이더스')
   */
  async analyzeTopicGroup(
    topic: TopicGroup,
    storeName: string = '코스트코',
  ): Promise<TopicAnalysisResult> {
    console.log(`[AnalysisAgent] 주제 분석 시작: ${topic.topicTitle}`);

    // 1단계: 주제 관련 콘텐츠에서 상품 정보 추출
    const initialAnalysis = await this.extractTopicInfo(topic, storeName);

    // 2단계: 정보 보강이 필요한 상품에 대해 검색 수행
    const enhancedProducts = await Promise.all(
      initialAnalysis.products.map(async (product) => {
        if (this.needsEnrichment(product)) {
          const searchResults = await searchStore(product.name, storeName, 3);
          if (searchResults.length > 0) {
            return this.enrichProductInfo(product, searchResults);
          }
        }
        return product;
      }),
    );

    return {
      topicId: topic.topicId,
      topicTitle: topic.topicTitle,
      category: topic.category,
      products: enhancedProducts,
      summary: initialAnalysis.summary,
      keywords: initialAnalysis.keywords,
    };
  }

  private async extractTopicInfo(
    topic: TopicGroup,
    storeName: string = '코스트코',
  ): Promise<AnalysisResult> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.0-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `당신은 ${storeName} 상품 분석 전문가입니다.
주어진 주제와 관련된 콘텐츠에서 상품 정보를 분석하여 구조화해주세요.

주제: ${topic.topicTitle}
카테고리: ${topic.category}
관련 상품 힌트: ${topic.products.join(', ')}

추출 항목:
1. 상품명 (구체적으로)
2. 가격 (언급된 경우)
3. 할인 정보 (할인 금액, 기간 등)
4. 장점 및 단점 (데이터 내 언급된 경우)
5. 추가 정보 (특징, 용량 등)

또한 이 주제에 대한 요약과 SEO 키워드 3-5개를 뽑아주세요.

반드시 다음 JSON 스키마를 따라 출력하세요:
{
  "products": [
    {
      "name": "string",
      "price": "string",
      "discountInfo": "string",
      "pros": ["string"],
      "cons": ["string"],
      "additionalInfo": "string"
    }
  ],
  "summary": "string",
  "keywords": ["string"]
}

관련 콘텐츠:
${topic.relevantContent}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text);
  }

  private needsEnrichment(product: AnalyzedProduct): boolean {
    // 정보가 너무 빈약한 경우 검색 필요로 판단
    return !product.price || !product.pros || product.pros.length === 0;
  }

  private async enrichProductInfo(
    product: AnalyzedProduct,
    searchResults: StoreSearchResult[],
  ): Promise<AnalyzedProduct> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.0-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const searchContext = searchResults
      .map((r, i) => `[결과 ${i + 1}] 제목: ${r.title}\n내용: ${r.snippet}`)
      .join('\n\n');

    const prompt = `제공된 검색 결과를 바탕으로 기존 상품 정보를 보강해주세요. 기존 정보에 없는 가격, 특징, 사용자 평가 등을 추가하세요.

반드시 다음 JSON 스키마를 따라 출력하세요:
{
  "name": "string",
  "price": "string",
  "discountInfo": "string",
  "pros": ["string"],
  "cons": ["string"],
  "additionalInfo": "string"
}

기존 정보:
${JSON.stringify(product)}

검색 결과:
${searchContext}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text);
  }
}
