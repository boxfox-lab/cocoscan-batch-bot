#!/bin/bash

# Jenkins Freestyle 프로젝트 자동 생성 스크립트
# cocoscan-batch-bot

set -e

# Jenkins 설정
JENKINS_URL="http://1.234.82.82:8088"
JOB_NAME="cocoscan-batch-bot"
CONFIG_FILE="jenkins-config.xml"

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================"
echo "Jenkins Freestyle 프로젝트 생성"
echo -e "======================================${NC}"
echo ""

# Jenkins 인증 정보 입력
echo -e "${YELLOW}Jenkins 인증 정보를 입력하세요:${NC}"
read -p "Jenkins 사용자명: " JENKINS_USER
read -sp "Jenkins API Token 또는 비밀번호: " JENKINS_TOKEN
echo ""
echo ""

# config.xml 파일 존재 확인
if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}❌ $CONFIG_FILE 파일을 찾을 수 없습니다.${NC}"
  echo "프로젝트 루트 디렉토리에서 실행하세요."
  exit 1
fi

echo -e "${GREEN}✅ Config 파일 확인 완료${NC}"
echo ""

# 기존 Job 확인
echo "기존 Job 확인 중..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --user "${JENKINS_USER}:${JENKINS_TOKEN}" \
  "${JENKINS_URL}/job/${JOB_NAME}/api/json")

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${YELLOW}⚠️  '${JOB_NAME}' Job이 이미 존재합니다.${NC}"
  read -p "덮어쓰시겠습니까? (y/N): " OVERWRITE

  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    echo "작업이 취소되었습니다."
    exit 0
  fi

  echo "기존 Job 업데이트 중..."
  curl -X POST \
    --user "${JENKINS_USER}:${JENKINS_TOKEN}" \
    -H "Content-Type: application/xml" \
    --data-binary "@${CONFIG_FILE}" \
    "${JENKINS_URL}/job/${JOB_NAME}/config.xml"

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Job 업데이트 완료!${NC}"
  else
    echo -e "${RED}❌ Job 업데이트 실패${NC}"
    exit 1
  fi
else
  echo "새 Job 생성 중..."
  curl -X POST \
    --user "${JENKINS_USER}:${JENKINS_TOKEN}" \
    -H "Content-Type: application/xml" \
    --data-binary "@${CONFIG_FILE}" \
    "${JENKINS_URL}/createItem?name=${JOB_NAME}"

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Job 생성 완료!${NC}"
  else
    echo -e "${RED}❌ Job 생성 실패${NC}"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}======================================"
echo "다음 단계"
echo -e "======================================${NC}"
echo ""
echo "1. Jenkins에서 환경 변수 설정:"
echo "   ${JENKINS_URL}/job/${JOB_NAME}/configure"
echo ""
echo "   필수 환경 변수 (Credentials):"
echo "   - COCOSCAN_DISCORD_WEBHOOK_URL"
echo "   - GEMINI_API_KEY"
echo "   - YOUTUBE_API_KEY"
echo "   - GOOGLE_SEARCH_API_KEY"
echo "   - GOOGLE_SEARCH_ENGINE_ID"
echo "   - DISCORD_DEV_WEBHOOK_URL"
echo ""
echo "2. 테스트 빌드 실행:"
echo "   ${JENKINS_URL}/job/${JOB_NAME}/build"
echo ""
echo -e "${GREEN}✅ 설정 완료!${NC}"
