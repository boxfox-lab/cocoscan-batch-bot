import { createCocoscanBatchBot } from "./createCocoscanBatchBot";
import { GlobalErrorHandler } from "./util/error/global-error-handler";
import { validateEnvironmentVariables } from "./config/env";
import { initializeDatabase, closeDatabase } from "./database/data-source";

process.on("uncaughtException", async (error) => {
  await GlobalErrorHandler.handleError(error, "UncaughtException");
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  await GlobalErrorHandler.handleError(error, "UnhandledRejection", {
    promise,
  });
  process.exit(1);
});

async function main() {
  try {
    // 환경변수 검증 (앱 시작 전 필수 체크)
    console.log("🔍 환경변수 검증 중...");
    const isValid = await validateEnvironmentVariables();
    if (!isValid) {
      console.error("❌ 환경변수 검증 실패 - 앱을 종료합니다");
      process.exit(1);
    }
    console.log("✅ 환경변수 검증 완료\n");

    // DB 연결
    console.log("🔌 데이터베이스 연결 중...");
    await initializeDatabase();
    console.log("✅ 데이터베이스 연결 완료\n");

    const start = createCocoscanBatchBot();
    await start();

    // 정상 종료 시 DB 연결 해제
    await closeDatabase();
  } catch (error) {
    await GlobalErrorHandler.handleError(error as Error, "main");
    // 에러 발생 시에도 DB 연결 해제
    await closeDatabase().catch(console.error);
    process.exit(1);
  }
}

main();
