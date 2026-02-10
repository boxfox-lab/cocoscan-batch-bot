/**
 * 파이프라인 통합 테스트 스크립트
 * DB 저장 없이 전체 파이프라인을 실행하여 최종 데이터를 확인합니다.
 *
 * 실행: npx ts-node -r tsconfig-paths/register src/scripts/test-pipeline.ts
 */
import "reflect-metadata";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { CaptionExtractionService } from "../module/cocoscan/services/caption-extraction.service";
import { CostcoSummaryService } from "../module/costco-summary";
import { getVideoDetails } from "../remotes/youtube";

const TARGET_URL = "https://www.youtube.com/watch?v=JWgkgKGmZI8";

function extractVideoId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
  return match ? match[1] : "";
}

async function main() {
  const videoId = extractVideoId(TARGET_URL);
  if (!videoId) {
    console.error("유효하지 않은 URL:", TARGET_URL);
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log(" 파이프라인 통합 테스트");
  console.log(`  URL: ${TARGET_URL}`);
  console.log(`  Video ID: ${videoId}`);
  console.log("=".repeat(60));

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  // ──────────────────────────────────────────────────
  // STEP 1: YouTube API로 메타데이터 조회
  // ──────────────────────────────────────────────────
  console.log("\n[STEP 1] YouTube API 메타데이터 조회...");
  const videoInfo = await getVideoDetails(videoId, apiKey);

  if (!videoInfo?.items?.length) {
    console.error("YouTube API에서 영상 정보를 찾을 수 없습니다.");
    process.exit(1);
  }

  const snippet = videoInfo.items[0].snippet;
  console.log(`  제목: ${snippet.title}`);
  console.log(`  채널: ${snippet.channelTitle} (${snippet.channelId})`);
  console.log(`  게시일: ${snippet.publishedAt}`);
  console.log(
    `  썸네일: ${
      snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url || "(없음)"
    }`
  );
  console.log(`  설명: ${snippet.description.substring(0, 150)}...`);

  // ──────────────────────────────────────────────────
  // STEP 2: 자막 추출
  // ──────────────────────────────────────────────────
  console.log("\n[STEP 2] 자막 추출 중...");
  const captionService = new CaptionExtractionService();
  const caption = await captionService.getVideoCaption(videoId);

  if (!caption) {
    console.error("자막 추출 실패: 모든 방법 실패");
    process.exit(1);
  }

  console.log(`  자막 길이: ${caption.length}자`);
  console.log(`  자막 미리보기: ${caption.substring(0, 300)}...`);

  if (caption.length < 200) {
    console.error(`  자막 길이 부족 (${caption.length}자 < 200자)`);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────
  // STEP 3: AI 요약 (Article 생성)
  // ──────────────────────────────────────────────────
  console.log("\n[STEP 3] AI 요약 시작 (CostcoSummaryService)...");
  const storeName = "코스트코";
  const costcoSummaryService = new CostcoSummaryService();
  const generatedArticles = await costcoSummaryService.generateArticles(
    caption,
    snippet.title,
    storeName
  );

  if (generatedArticles.length === 0) {
    console.error("  AI 요약 결과: Article 0개 생성됨");
    process.exit(1);
  }

  console.log(`  생성된 Article: ${generatedArticles.length}개`);

  // ──────────────────────────────────────────────────
  // STEP 4: 최종 데이터 구성 (DB 저장 직전 상태)
  // ──────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(" 최종 데이터 (DB 저장 직전)");
  console.log("=".repeat(60));

  // YoutubeEntity 데이터
  const youtubeData = {
    link: TARGET_URL,
    channelName: snippet.channelTitle,
    channelId: snippet.channelId,
    channelType: "costco" as const,
    title: snippet.title,
    snippet: snippet.description,
    publishedAt: new Date(snippet.publishedAt),
    thumbnail: snippet.thumbnails.high?.url || snippet.thumbnails.medium?.url,
    sourceType: "manual" as const,
    processStatus: "completed" as const,
    processMessage: `처리 완료: ${generatedArticles.length}개 Article 생성`,
    processedAt: new Date(),
  };

  console.log("\n[youtube 테이블 저장 데이터]");
  console.log(JSON.stringify(youtubeData, null, 2));

  // ArticleEntity 데이터
  const articleDtos = generatedArticles.map((article) => ({
    youtubeLink: TARGET_URL,
    topicTitle: article.topicTitle,
    category: article.category,
    title: article.title,
    content: article.content,
    summary: article.summary,
    keywords: article.keywords,
    products: article.products,
  }));

  console.log(`\n[article 테이블 저장 데이터] (${articleDtos.length}건)`);
  for (let i = 0; i < articleDtos.length; i++) {
    const dto = articleDtos[i];
    console.log(`\n--- Article ${i + 1}/${articleDtos.length} ---`);
    console.log(`  topicTitle: ${dto.topicTitle}`);
    console.log(`  category: ${dto.category}`);
    console.log(`  title: ${dto.title}`);
    console.log(`  summary: ${dto.summary}`);
    console.log(`  keywords: [${dto.keywords.join(", ")}]`);
    console.log(`  products: ${dto.products.length}개`);
    if (dto.products.length > 0) {
      for (const p of dto.products.slice(0, 5)) {
        console.log(`    - ${JSON.stringify(p)}`);
      }
      if (dto.products.length > 5)
        console.log(`    ... 외 ${dto.products.length - 5}개`);
    }
    console.log(`  content 길이: ${dto.content.length}자`);
    console.log(`  content 미리보기: ${dto.content.substring(0, 200)}...`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(" 파이프라인 테스트 완료");
  console.log(
    `  youtube: 1건, article: ${articleDtos.length}건 — DB 저장 준비 완료`
  );
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("파이프라인 테스트 실패:", error);
  process.exit(1);
});
