import { GoogleGenerativeAI } from '@google/generative-ai';
import { TopicGroup, TopicSplitResult } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class TopicSplitterAgent {
  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    this.genAI = new GoogleGenerativeAI(key);
  }

  /**
   * 자막을 분석하여 주제별로 분류합니다
   * @param rawData 유튜브 자막 원본
   * @param videoTitle 원본 영상 제목 (SEO 키워드 참고용)
   * @param storeName 매장 브랜드명 (예: '코스트코', '이마트 트레이더스')
   */
  async split(
    rawData: string,
    videoTitle?: string,
    storeName: string = '코스트코',
  ): Promise<TopicSplitResult> {
    console.log(`[TopicSplitterAgent] 주제 분류 시작 (${storeName})...`);

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `당신은 ${storeName} 관련 콘텐츠 분석 전문가입니다.
주어진 유튜브 자막을 분석하여 독립적인 주제/관심사별로 분류해주세요.
${videoTitle ? `\n영상 제목 (주제 분류 힌트로 활용): ${videoTitle}` : ''}

분류 기준:
1. 각 주제는 독자에게 의미있는 단위여야 합니다 (예: "이번 주 식품 할인", "생활용품 추천", "신상품 리뷰")
2. 같은 카테고리의 상품들은 하나의 주제로 묶어주세요
3. 주제가 명확히 구분되지 않거나 1개뿐이면 전체를 하나의 주제로 처리해도 됩니다
4. 최대 5개 주제까지만 분류해주세요
5. 각 주제에는 반드시 관련된 자막 내용(relevantContent)을 포함해주세요

카테고리 예시:
- 식품: 신선식품, 냉동식품, 과일, 육류, 해산물, 유제품, 빵/베이커리, 음료
- 생활용품: 청소용품, 주방용품, 욕실용품, 세제
- 가전/전자: TV, 컴퓨터, 소형가전
- 의류/패션: 의류, 신발, 액세서리
- 건강/뷰티: 건강식품, 화장품, 개인위생
- 할인정보: 이번 주 할인, 특가, 쿠폰
- 신상품: 새로 출시된 상품
- 매장정보: 영업시간, 이벤트, 매장별 정보

반드시 다음 JSON 스키마를 따라 출력하세요:
{
  "topics": [
    {
      "topicTitle": "string (주제 제목, 예: 이번 주 식품 할인 BEST 5)",
      "category": "string (카테고리명)",
      "relevantContent": "string (해당 주제와 관련된 자막 내용 전체)",
      "products": ["string (상품명 목록)"]
    }
  ],
  "overallSummary": "string (전체 영상 요약 1-2문장)"
}

입력 자막:
${rawData}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as {
      topics: Omit<TopicGroup, 'topicId'>[];
      overallSummary: string;
    };

    // 각 주제에 고유 ID 부여
    const topicsWithId: TopicGroup[] = parsed.topics.map((topic) => ({
      ...topic,
      topicId: uuidv4(),
    }));

    console.log(`[TopicSplitterAgent] ${topicsWithId.length}개 주제 분류 완료`);

    return {
      topics: topicsWithId,
      overallSummary: parsed.overallSummary,
    };
  }
}
