import "reflect-metadata";
import { DataSource } from "typeorm";
import { YoutubeEntity } from "../entity/youtube.entity";
import { YoutubeRequestEntity } from "../entity/youtube-request.entity";
import { ArticleEntity } from "../entity/article.entity";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "cocoscan",
  entities: [YoutubeEntity, YoutubeRequestEntity, ArticleEntity],
  synchronize: false, // 절대 true 금지 (마이그레이션 사용)
  logging: process.env.NODE_ENV === "development",
});

/**
 * DB 연결 초기화
 */
export async function initializeDatabase(): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("[Database] 연결 성공");
    }
  } catch (error) {
    console.error("[Database] 연결 실패:", error);
    throw error;
  }
}

/**
 * DB 연결 종료
 */
export async function closeDatabase(): Promise<void> {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log("[Database] 연결 종료");
    }
  } catch (error) {
    console.error("[Database] 연결 종료 실패:", error);
    throw error;
  }
}
