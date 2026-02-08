# Jenkins Freestyle Project 설정 가이드 - cocoscan-batch-bot

## 1. 프로젝트 생성

1. Jenkins 대시보드 → **새로운 Item**
2. 이름: `cocoscan-batch-bot`
3. **Freestyle project** 선택 → OK

---

## 2. General 설정

### 프로젝트 정보
- **Description**: `Cocoscan Batch Bot - Costco/E-Mart Traders YouTube/Article 수집 및 AI 요약`
- **GitHub project** (선택):
  - ✅ 체크
  - Project url: `https://github.com/your-org/cocoscan-batch-bot/` (실제 저장소 URL로 변경)

### 기타 옵션
- ✅ **Discard old builds**
  - Days to keep builds: `30`
  - Max # of builds to keep: `20`

---

## 3. Source Code Management

### Git 선택
- **Repository URL**: `https://github.com/your-org/cocoscan-batch-bot.git` (실제 저장소로 변경)
- **Credentials**:
  - 없으면 **Add** → **Jenkins** 클릭
  - Kind: `Username with password` (또는 SSH key)
  - Username: GitHub 사용자명
  - Password: Personal Access Token (또는 비밀번호)
  - ID: `github-cocoscan-credentials`
  - Description: `GitHub Cocoscan Repository`

### Branches to build
- **Branch Specifier**: `*/main` (또는 `*/master`)

### Additional Behaviours (선택)
- **Clean before checkout** 추가 권장 (매번 깨끗한 워크스페이스 보장)

---

## 4. Build Triggers

### 옵션 1: GitHub Webhook (권장)
- ✅ **GitHub hook trigger for GITScm polling**

**GitHub 설정 (별도):**
1. GitHub 저장소 → Settings → Webhooks → Add webhook
2. Payload URL: `http://your-jenkins-url/github-webhook/`
3. Content type: `application/json`
4. Events: `Just the push event`

### 옵션 2: 폴링 (Webhook 불가 시)
- ✅ **Poll SCM**
- Schedule: `H/5 * * * *` (5분마다 체크)

---

## 5. Build Environment

### 환경 변수 설정

✅ **Use secret text(s) or file(s)** 체크

**Bindings 추가 (각 환경 변수마다 추가):**

| Variable | Credentials | 설명 |
|----------|-------------|------|
| `COCOSCAN_DISCORD_WEBHOOK_URL` | Secret text | Discord 웹훅 URL |
| `GEMINI_API_KEY` | Secret text | Google Gemini API 키 |
| `YOUTUBE_API_KEY` | Secret text | YouTube Data API 키 |
| `GOOGLE_SEARCH_API_KEY` | Secret text | Google Custom Search API 키 |
| `GOOGLE_SEARCH_ENGINE_ID` | Secret text | Custom Search Engine ID |
| `DISCORD_DEV_WEBHOOK_URL` | Secret text | 개발 Discord 웹훅 URL |

**Credentials 추가 방법:**
1. **Add** → **Jenkins** 클릭
2. Kind: `Secret text`
3. Secret: 실제 값 입력
4. ID: 변수명과 동일하게 (예: `GEMINI_API_KEY`)
5. Description: 설명 (예: `Google Gemini API Key`)

**추가 옵션:**
- ✅ **Delete workspace before build starts** (선택 - 매번 깨끗한 빌드)

---

## 6. Build Steps

### Step 1: Install Dependencies
- **Add build step** → **Execute shell**

```bash
#!/bin/bash
set -e  # 에러 발생 시 즉시 중단

echo "======================================"
echo "📦 Step 1: Install Dependencies"
echo "======================================"

yarn install --frozen-lockfile
```

### Step 2: Run Tests
- **Add build step** → **Execute shell**

```bash
#!/bin/bash
set -e

echo "======================================"
echo "🧪 Step 2: Run Unit & E2E Tests"
echo "======================================"

yarn test
```

### Step 3: Build Application
- **Add build step** → **Execute shell**

```bash
#!/bin/bash
set -e

echo "======================================"
echo "🏗️  Step 3: Build Application"
echo "======================================"

yarn build:new
```

### Step 4: Deploy to Production
- **Add build step** → **Execute shell**

```bash
#!/bin/bash
set -e

echo "======================================"
echo "🚀 Step 4: Deploy to Production"
echo "======================================"

yarn deploy
```

### Step 5: Verify Deployment
- **Add build step** → **Execute shell**

```bash
#!/bin/bash
set -e

echo "======================================"
echo "✅ Step 5: Verify Deployment"
echo "======================================"

# PM2 프로세스 상태 확인
npx pm2 list | grep cocoscan-batch-bot

# 로그 최근 10줄 확인
echo ""
echo "📋 Recent logs:"
npx pm2 logs cocoscan-batch-bot --lines 10 --nostream || true
```

---

## 7. Post-build Actions

### Discord 알림 (성공 시)

**Add post-build action** → **Execute a set of scripts**

- **Build step** → **Execute shell**
- **Run only if build succeeds** 선택

```bash
#!/bin/bash

DISCORD_WEBHOOK="${COCOSCAN_DISCORD_WEBHOOK_URL}"

curl -X POST -H "Content-Type: application/json" \
  -d "{
    \"content\": \"🚀 **${JOB_NAME}** (cocoscan-batch-bot) Build #${BUILD_NUMBER} 성공!\",
    \"embeds\": [{
      \"title\": \"빌드 성공\",
      \"color\": 3066993,
      \"fields\": [
        {\"name\": \"Job\", \"value\": \"${JOB_NAME}\", \"inline\": true},
        {\"name\": \"Build\", \"value\": \"#${BUILD_NUMBER}\", \"inline\": true},
        {\"name\": \"Branch\", \"value\": \"${GIT_BRANCH}\", \"inline\": true},
        {\"name\": \"Duration\", \"value\": \"${BUILD_DURATION}ms\", \"inline\": true}
      ],
      \"url\": \"${BUILD_URL}\"
    }]
  }" \
  "${DISCORD_WEBHOOK}"
```

### Discord 알림 (실패 시)

**Add post-build action** → **Execute a set of scripts**

- **Build step** → **Execute shell**
- **Run only if build fails or is unstable** 선택

```bash
#!/bin/bash

DISCORD_WEBHOOK="${COCOSCAN_DISCORD_WEBHOOK_URL}"

curl -X POST -H "Content-Type: application/json" \
  -d "{
    \"content\": \"❌ **${JOB_NAME}** (cocoscan-batch-bot) Build #${BUILD_NUMBER} 실패!\",
    \"embeds\": [{
      \"title\": \"빌드 실패\",
      \"color\": 15158332,
      \"fields\": [
        {\"name\": \"Job\", \"value\": \"${JOB_NAME}\", \"inline\": true},
        {\"name\": \"Build\", \"value\": \"#${BUILD_NUMBER}\", \"inline\": true},
        {\"name\": \"Branch\", \"value\": \"${GIT_BRANCH}\", \"inline\": true}
      ],
      \"description\": \"로그: ${BUILD_URL}console\"
    }]
  }" \
  "${DISCORD_WEBHOOK}"
```

---

## 8. Jenkins 환경 변수 .env 파일 주입 (대안)

만약 Jenkins Credentials 대신 `.env` 파일을 직접 생성하려면:

### Build Environment
- ✅ **Inject environment variables to the build process** (EnvInject Plugin 필요)

### Properties Content
```bash
TZ=Asia/Seoul
COCOSCAN_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
GEMINI_API_KEY=your_gemini_api_key
YOUTUBE_API_KEY=your_youtube_api_key
GOOGLE_SEARCH_API_KEY=your_google_search_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
DISCORD_DEV_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

**⚠️ 보안 주의**: 민감한 정보가 Jenkins 설정에 평문으로 저장되므로 **Credentials 방식 권장**

---

## 9. 필수 플러그인 설치

Jenkins 관리 → 플러그인 관리 → Available plugins

- ✅ **Git Plugin** (기본 설치됨)
- ✅ **GitHub Plugin** (GitHub 통합)
- ✅ **EnvInject Plugin** (환경 변수 주입 - 선택)
- ✅ **Post Build Task Plugin** (조건부 post-build - 선택)

---

## 10. 테스트 빌드

1. **지금 빌드** 클릭
2. 콘솔 출력 확인:
   - Dependencies 설치 ✅
   - Tests 통과 ✅
   - Build 성공 ✅
   - Deploy 성공 ✅
   - PM2 프로세스 실행 확인 ✅
   - Discord 알림 수신 ✅

---

## 11. 문제 해결

### 빌드 실패 시

**1. 의존성 설치 실패**
```bash
# Jenkins 서버에 Node.js/Yarn 설치 확인
node -v
yarn -v
```

**2. 테스트 실패**
```bash
# 로컬에서 테스트 실행하여 사전 확인
yarn test
```

**3. 빌드 실패**
```bash
# TypeScript 컴파일 에러 확인
yarn build:new
```

**4. 배포 실패**
```bash
# PM2 프로세스 상태 확인
pm2 list
pm2 logs cocoscan-batch-bot
```

**5. Discord 알림 없음**
- Webhook URL 확인
- Jenkins에서 환경 변수 제대로 주입되었는지 확인
- 콘솔 출력에서 curl 명령 에러 확인

---

## 12. 고급 설정 (선택)

### 병렬 빌드 방지
- General → ✅ **Do not allow concurrent builds**

### 빌드 스케줄링
- Build Triggers → ✅ **Build periodically**
- Schedule: `H 2 * * *` (매일 새벽 2시)

### 빌드 파라미터화
- General → ✅ **This project is parameterized**
- Add Parameter → **Choice Parameter**
  - Name: `ENVIRONMENT`
  - Choices: `production`, `staging`

---

## 13. 보안 체크리스트

- [ ] GitHub Credentials는 Personal Access Token 사용
- [ ] 민감한 환경 변수는 Jenkins Credentials로 관리
- [ ] Discord Webhook URL은 외부 노출 금지
- [ ] Jenkins 접근 권한 설정 (Matrix Authorization)
- [ ] HTTPS 사용 (Jenkins URL)

---

## 요약

| 단계 | 내용 |
|------|------|
| **1. General** | 프로젝트명, 빌드 보존 정책 |
| **2. SCM** | Git 저장소, Branch 설정 |
| **3. Triggers** | GitHub Webhook 또는 Poll SCM |
| **4. Environment** | Secret Credentials 주입 |
| **5. Build Steps** | Install → Test → Build → Deploy → Verify |
| **6. Post-build** | Discord 알림 (성공/실패) |

---

## 다음 단계

1. ✅ Jenkins Freestyle 프로젝트 생성
2. ✅ GitHub 연동 및 Webhook 설정
3. ✅ Credentials 추가 (환경 변수)
4. ✅ Build Steps 스크립트 작성
5. ✅ Discord 알림 설정
6. ✅ 테스트 빌드 실행
7. ✅ 프로덕션 배포 확인
