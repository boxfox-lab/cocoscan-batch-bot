import { sendDevMessage } from '../remotes/discord';

const {
  COCOSCAN_DISCORD_WEBHOOK_URL,
  GEMINI_API_KEY,
  YOUTUBE_API_KEY,
  GOOGLE_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_ID,
  DISCORD_DEV_WEBHOOK_URL,
} = process.env;

/**
 * 필수 환경변수 목록
 */
const REQUIRED_ENV_VARS = {
  COCOSCAN_DISCORD_WEBHOOK_URL: 'Cocoscan Discord 웹훅 URL',
  GEMINI_API_KEY: 'Google Gemini API 키 (AI 요약용)',
  YOUTUBE_API_KEY: 'YouTube Data API 키',
  GOOGLE_SEARCH_API_KEY: 'Google Custom Search API 키',
  GOOGLE_SEARCH_ENGINE_ID: 'Google Custom Search Engine ID',
} as const;

/**
 * 환경변수 검증 및 Discord 알림
 * @returns 모든 필수 환경변수가 존재하면 true, 아니면 false
 */
export async function validateEnvironmentVariables(): Promise<boolean> {
  const missingVars: string[] = [];
  const details: string[] = [];

  for (const [key, description] of Object.entries(REQUIRED_ENV_VARS)) {
    if (!process.env[key]) {
      missingVars.push(key);
      details.push(`❌ **${key}**: ${description} - **누락됨**`);
    } else {
      details.push(`✅ **${key}**: ${description} - 설정됨`);
    }
  }

  if (missingVars.length > 0) {
    const errorMessage = `
🚨 **환경변수 검증 실패**

**누락된 환경변수:** ${missingVars.length}개

${details.join('\n')}

**해결 방법:**
1. \`.env\` 파일에 누락된 환경변수 추가
2. 또는 \`ecosystem.config.js\`의 env 섹션에 추가
3. PM2 재시작: \`pm2 restart cocoscan-batch-bot\`

**시간:** ${new Date().toISOString()}
    `.trim();

    console.error('🚨 환경변수 검증 실패:', missingVars);

    try {
      // Discord로 알림 전송
      await sendDevMessage(errorMessage);
    } catch (discordError) {
      console.error('Discord 알림 전송 실패:', discordError);
    }

    return false;
  }

  console.log('✅ 모든 필수 환경변수 검증 완료');
  return true;
}

export {
  COCOSCAN_DISCORD_WEBHOOK_URL,
  GEMINI_API_KEY,
  YOUTUBE_API_KEY,
  GOOGLE_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_ID,
  DISCORD_DEV_WEBHOOK_URL,
};
