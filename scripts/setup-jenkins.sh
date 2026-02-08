#!/bin/bash

# Jenkins Freestyle 프로젝트 자동 생성 스크립트
# cocoscan-batch-bot

set -e

# Jenkins 설정
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

# ~/.cursor/jenkins.env에서 환경 변수 로드
if [ -f ~/.cursor/jenkins.env ]; then
  echo "환경 변수 로드 중..."
  source ~/.cursor/jenkins.env
  echo -e "${GREEN}✅ 환경 변수 로드 완료${NC}"
  echo "  - JENKINS_URL: ${JENKINS_URL}"
  echo "  - JENKINS_USER: ${JENKINS_USER}"
  echo ""
else
  echo -e "${RED}❌ ~/.cursor/jenkins.env 파일을 찾을 수 없습니다.${NC}"
  exit 1
fi

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
  echo "자동으로 덮어쓰기를 진행합니다..."
  echo ""

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
