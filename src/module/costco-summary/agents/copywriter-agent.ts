import { GoogleGenerativeAI } from '@google/generative-ai';
import { TopicAnalysisResult } from './analysis-agent';

/** 작성된 Article 초안 */
export interface ArticleDraft {
  /** SEO 최적화 제목 */
  title: string;
  /** 마크다운 본문 */
  content: string;
  /** 3줄 요약 */
  summary: string;
}

export class CopywriterAgent {
  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    this.genAI = new GoogleGenerativeAI(key);
  }

  /**
   * 주제별 분석 결과를 바탕으로 독립적인 Article 초안을 작성합니다
   * @param topicAnalysis 주제별 분석 결과
   * @param videoTitle 원본 영상 제목 (SEO 키워드 참고용)
   * @param storeName 매장 브랜드명 (예: '코스트코', '이마트 트레이더스')
   */
  async writeForTopic(
    topicAnalysis: TopicAnalysisResult,
    videoTitle?: string,
    storeName: string = '코스트코',
  ): Promise<ArticleDraft> {
    console.log(
      `[CopywriterAgent] 주제별 콘텐츠 작성 시작: ${topicAnalysis.topicTitle}`,
    );

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.0-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const now = new Date();
    const yearMonth = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

    const prompt = `당신은 ${storeName} 쇼핑과 장보기에 관심이 있는 정보 제공 블로거입니다.
주어진 주제와 분석된 상품 정보를 바탕으로 완전히 독립적인 정보성 블로그 글을 작성해주세요.
이 글은 객관적이고 유용한 정보를 제공하는 형태로 작성해야 합니다.

주제: ${topicAnalysis.topicTitle}
카테고리: ${topicAnalysis.category}
${
  videoTitle
    ? `참고 영상 제목 (SEO 키워드 참고용, 본문에 언급 금지): ${videoTitle}`
    : ''
}
SEO 키워드 (본문에 자연스럽게 포함): ${topicAnalysis.keywords.join(', ')}

## 제목 작성 규칙 (SEO 최우선)
1. 반드시 60자 이내로 작성하세요.
2. "${storeName}"를 반드시 포함하세요. ${
      storeName === '이마트 트레이더스'
        ? '(제목이 너무 길어질 경우 "트레이더스"로 축약 가능)'
        : ''
    }
3. 카테고리와 핵심 상품명을 포함하세요.
4. 제목 패턴 예시:
   - "${yearMonth} ${storeName} ${topicAnalysis.category} 할인 추천 TOP 5"
   - "${storeName} [상품명] 가격 비교 및 구매 팁"
   - "${storeName} ${topicAnalysis.category} 신상품 리뷰 | 가격·특징 총정리"
5. 영상 제목을 그대로 사용하지 말고, 글 내용에 맞게 SEO 최적화된 새로운 제목을 생성하세요.

## summary 작성 규칙 (meta description용)
1. 반드시 155자 이내로 작성하세요 (Google 검색 snippet 최적 길이).
2. "${storeName}"를 반드시 포함하세요.
3. 핵심 키워드를 자연스럽게 포함하세요.
4. 독자가 클릭하고 싶어지는 요약문을 작성하세요.

## 블로그 글 작성 스타일
1. **서론**: 글의 주제를 자연스럽게 소개하고 독자의 관심을 끄는 도입부 작성
2. **본문**:
   - 각 문단은 하나의 주제를 중심으로 자연스럽게 연결
   - 객관적인 정보와 특징을 중심으로 서술
   - 상품 정보, 가격, 구매 팁 등을 구체적이고 실용적으로 설명
3. **결론**: 핵심 내용을 요약하고 독자에게 도움이 되는 마무리

## 작성 가이드
1. 반드시 마크다운 형식으로 작성하세요 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용)
2. 블로그 글의 전형적인 구조를 따르세요: 서론 → 본문(여러 문단) → 결론
3. 각 문단은 3-5문장으로 구성하고, 자연스러운 흐름으로 연결하세요
4. 정보 제공 형태로 작성하세요 ("~할 것 같아요", "~한 특징이 있어요", "~로 알려져 있어요", "~라고 하네요" 등 정보 전달 뉘앙스)
5. 상품명, 가격, 구매 팁, 특징 등을 구체적이고 실용적으로 설명하세요
6. SEO 키워드(${topicAnalysis.keywords.join(
      ', ',
    )})를 본문 내에 자연스럽게 포함하되, 키워드 밀도가 과하지 않게 하세요
7. ${storeName} 관련 키워드를 자연스럽게 포함하세요
8. 객관적 사실과 정보를 중심으로 작성하되, 주부나 일반 쇼퍼의 관점에서 친근하게 표현하세요
9. 각 정보를 문장으로 연결하여 설명하되, 일상 대화하듯이 편안하게 작성하세요
10. 자막 기반 데이터이므로 발음이 어색하거나 이상한 단어가 있을 수 있습니다. 문맥상 유추 가능한 선에서 올바른 단어로 정정하여 자연스럽게 작성하세요
11. 반드시 일관된 존댓말 어투를 사용하되, 친근하고 가벼운 느낌으로 작성하세요 ("~해요", "~이에요", "~거예요")
12. 직접 경험한 것처럼 표현하지 말고, 정보나 특징을 전달하는 형태로 작성하세요
    - ❌ "제가 직접 사용해봤는데요" → ✅ "~할 것 같아요", "~한 특징이 있어요"
    - ❌ "~하더라고요" → ✅ "~한 특징이 있어요", "~로 알려져 있어요"
13. 마지막에는 관련 키워드를 해시태그 형태로 포함하세요

## 절대 금지 사항
1. "AI로 요약했다", "이 글은 AI가 작성했습니다", "요약본입니다" 등 메타 설명이나 작성 과정에 대한 언급
2. "참고 출처", "채널명:", "영상 제목:", "출처:" 등 메타 정보나 참고 문구
3. 단순 리스트 나열 형태(-, *, 번호)로 작성하지 마세요. 반드시 자연스러운 문단과 문장으로 설명하세요
4. 삭선(취소선) 마크다운 형식(~~텍스트~~)을 절대 사용하지 마세요
5. 유튜버, 채널명, 크리에이터, 영상 제목 등을 절대 언급하지 마세요
6. 유튜브 영상이나 특정 출처에 대한 언급을 절대 하지 마세요

분석 데이터:
${JSON.stringify(topicAnalysis, null, 2)}

반드시 다음 JSON 스키마를 따라 출력하세요:
{
  "title": "string (60자 이내 SEO 최적화 제목, '${storeName}'${
      storeName === '이마트 트레이더스' ? ' 또는 "트레이더스"' : ''
    } 필수 포함)",
  "content": "string (마크다운 형식의 전체 본문)",
  "summary": "string (155자 이내 meta description용 요약, '${storeName}' 필수 포함)"
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as ArticleDraft;

    // 삭선 제거 (안전장치)
    if (parsed.content) {
      parsed.content = parsed.content.replace(/~~([^~]+)~~/g, '$1');
    }

    return parsed;
  }
}
