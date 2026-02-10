import { GoogleGenerativeAI } from "@google/generative-ai";
import { TopicAnalysisResult } from "./analysis-agent";
import { ArticleDraft } from "./copywriter-agent";

export class ProofreaderAgent {
  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.");
    }
    this.genAI = new GoogleGenerativeAI(key);
  }

  /**
   * Article 초안을 교정합니다 (주제별 분석)
   * @param draft 초안
   * @param originalAnalysis 원본 분석 데이터
   * @param storeName 매장 브랜드명 (예: '코스트코', '이마트 트레이더스')
   */
  async proofreadArticle(
    draft: ArticleDraft,
    originalAnalysis: TopicAnalysisResult,
    storeName: string = "코스트코"
  ): Promise<ArticleDraft> {
    console.log(`[ProofreaderAgent] Article 교정 시작: ${draft.title}`);

    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `당신은 전문 편집자이자 팩트 체크 전문가이자 SEO 리뷰어입니다.
제공된 Article 초안이 원본 분석 데이터와 일치하는지 확인하고, 문법, 가독성, 스타일, SEO를 교정하여 최종 결과물을 만들어주세요.

## 팩트 체크 & 품질 교정
1. 정보의 정확성: 가격이나 할인 정보가 원본 데이터와 일치하는가?
2. 문법 및 오타: 어색한 표현이나 오타가 없는가?
3. 가독성: 문단 구성이 적절하고 읽기 편한가? (단순 리스트 나열이 아닌 자연스러운 문장 흐름)
4. 어투 일관성: "~해요", "~이에요" 등 친근하고 일관된 존댓말 유지
5. 마크다운 형식이 올바르게 적용되었는가?
6. 삭선(~~텍스트~~)은 모두 제거하세요.

## 금지 사항 체크
7. "AI가 작성했다", "요약본입니다" 등 메타 설명이 포함되어 있으면 제거하세요.
8. 유튜버, 채널명, 크리에이터, 영상 제목 언급이 있으면 제거하세요.
9. "출처:", "참고:" 등의 메타 정보가 있으면 제거하세요.

## 제목 스타일 교정 (최우선 — 네이버 블로그 상위노출 스타일)
10. 제목이 60자 이내인지 확인하세요. 초과 시 핵심 키워드를 유지하면서 축약하세요.
11. 제목에 "${storeName}"가 포함되어 있는지 확인하세요. 없으면 추가하세요.
12. 제목에 콜론(:)이나 파이프(|)가 있으면 반드시 제거하고 자연스러운 구어체로 바꾸세요.
13. 다음 금지 단어가 제목에 있으면 반드시 제거하세요: "쇼핑 필수템", "상품 정보", "꿀팁", "알뜰 쇼핑", "한 번에", "쇼핑"
14. 제목이 다음 상위 블로그 스타일과 유사한지 확인하세요:
   - 좋은 예: "${storeName} 프라이드 치킨 먹어봤는데 역대급! 롤케이크도 바로 담았어요"
   - 좋은 예: "${storeName} 2월 할인상품 중 놓치면 아쉬운 5가지"
   - 좋은 예: "${storeName} 신상 팝콘 치킨, 미니 초코 와퍼콘 품절 전에 득템하세요"
   - 나쁜 예: "${storeName} 식품 추천: 프라이드 치킨, 베이커리 등 맛있는 식품 정보!" ← 콜론, 제네릭
   - 나쁜 예: "${storeName} 육류 & 해산물 쇼핑 가이드" ← "쇼핑", 제네릭
15. 초안 제목이 이미 블로그 스타일이면 불필요하게 수정하지 마세요. 더 좋은 대안이 있을 때만 변경하세요.

## SEO 교정
16. summary가 155자 이내인지 확인하세요. 초과 시 핵심을 유지하면서 축약하세요.
17. summary에 "${storeName}"가 포함되어 있는지 확인하세요. 없으면 추가하세요.
18. 본문에 SEO 키워드(${originalAnalysis.keywords.join(
      ", "
    )})가 자연스럽게 포함되어 있는지 확인하세요.
19. 본문이 자연스럽고 정보 전달 형태로 작성되어 있는지 확인하세요.

원본 분석 데이터:
${JSON.stringify(originalAnalysis, null, 2)}

작성된 초안:
${JSON.stringify(draft, null, 2)}

반드시 다음 JSON 스키마를 따라 출력하세요:
{
  "title": "string (60자 이내, '${storeName}' 필수 포함, SEO 최적화된 교정 제목)",
  "content": "string (교정된 마크다운 본문)",
  "summary": "string (155자 이내, '${storeName}' 필수 포함, meta description용 교정 요약)"
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as ArticleDraft;

    // 삭선 제거 (안전장치)
    if (parsed.content) {
      parsed.content = parsed.content.replace(/~~([^~]+)~~/g, "$1");
    }

    return parsed;
  }
}
