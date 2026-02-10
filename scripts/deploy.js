#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_NAME = "cocoscan-batch-bot";
const DIST_DIR = path.join(__dirname, "..", "dist");
const DIST_NEW_DIR = path.join(__dirname, "..", "dist-new");
const DIST_BACKUP_DIR = path.join(__dirname, "..", "dist-backup");

// 에러 발생 시 즉시 중단
process.on("uncaughtException", (error) => {
  console.error("❌ 배포 중 치명적 오류 발생:", error.message);
  rollback();
  process.exit(1);
});

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function exec(command, options = {}) {
  try {
    log(`실행: ${command}`);
    return execSync(command, {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
      ...options,
    });
  } catch (error) {
    log(`❌ 명령 실행 실패: ${command}`);
    throw error;
  }
}

function exists(dir) {
  return fs.existsSync(dir);
}

function removeDir(dir) {
  if (exists(dir)) {
    log(`삭제: ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function moveDir(src, dest) {
  if (exists(src)) {
    log(`이동: ${src} -> ${dest}`);
    if (exists(dest)) {
      removeDir(dest);
    }
    fs.renameSync(src, dest);
  }
}

function copyDir(src, dest) {
  if (exists(src)) {
    log(`복사: ${src} -> ${dest}`);
    if (exists(dest)) {
      removeDir(dest);
    }
    fs.cpSync(src, dest, { recursive: true });
  }
}

function rollback() {
  log("🔄 롤백 시작...");
  try {
    if (exists(DIST_BACKUP_DIR)) {
      log("백업에서 복원 중...");
      removeDir(DIST_DIR);
      moveDir(DIST_BACKUP_DIR, DIST_DIR);
      log("✅ 롤백 완료");
    } else {
      log("⚠️  백업 디렉토리가 없어 롤백할 수 없습니다.");
    }
  } catch (error) {
    log(`❌ 롤백 실패: ${error.message}`);
  }
}

/**
 * PM2 앱 상태를 확인합니다.
 * @returns 'online' | 'stopped' | 'not_found'
 */
function getPm2Status() {
  try {
    const result = execSync(`npx pm2 jlist`, {
      stdio: "pipe",
      cwd: path.join(__dirname, ".."),
    });
    const list = JSON.parse(result.toString());
    const app = list.find((p) => p.name === APP_NAME);
    if (!app) return "not_found";
    return app.pm2_env?.status === "online" ? "online" : "stopped";
  } catch (error) {
    return "not_found";
  }
}

function main() {
  log("🚀 Zero-downtime 배포 시작");

  try {
    // 1. dist-new 디렉토리에 빌드
    log("📦 새 빌드 시작...");
    exec("npm run build:new");

    // 2. 빌드 성공 확인 (dist-new/src/index.js 파일 존재 확인)
    if (
      !exists(DIST_NEW_DIR) ||
      !exists(path.join(DIST_NEW_DIR, "src", "index.js"))
    ) {
      throw new Error(
        "빌드 실패: dist-new/src/index.js 파일이 생성되지 않았습니다."
      );
    }
    log("✅ 빌드 성공");

    // 3. 기존 dist를 dist-backup으로 백업
    if (exists(DIST_DIR)) {
      log("💾 기존 빌드 백업 중...");
      removeDir(DIST_BACKUP_DIR);
      copyDir(DIST_DIR, DIST_BACKUP_DIR);
      log("✅ 백업 완료");
    }

    // 4. dist-new를 dist로 교체
    log("🔄 새 빌드 배포 중...");
    removeDir(DIST_DIR);
    moveDir(DIST_NEW_DIR, DIST_DIR);
    log("✅ 빌드 교체 완료");

    // 5. PM2 상태에 따라 적절한 명령 실행
    const pm2Status = getPm2Status();
    log(`📊 PM2 상태: ${pm2Status}`);

    if (pm2Status === "online") {
      log("🔄 PM2 reload 실행 중...");
      exec(
        `npx pm2 reload ecosystem.config.js --only "${APP_NAME}" --update-env`
      );
      log("✅ PM2 reload 완료");
    } else {
      if (pm2Status === "stopped") {
        log("⚠️  PM2 프로세스가 stopped 상태입니다. 삭제 후 재시작합니다.");
        exec(`npx pm2 delete "${APP_NAME}"`);
      }
      log("🚀 PM2 start 실행 중...");
      exec(`npx pm2 start ecosystem.config.js --only "${APP_NAME}"`);
      log("✅ PM2 start 완료");
    }

    // 6. 시작 후 상태 확인
    const finalStatus = getPm2Status();
    if (finalStatus !== "online") {
      throw new Error(
        `PM2 프로세스가 정상 실행되지 않았습니다. (상태: ${finalStatus})`
      );
    }

    // 7. 배포 성공 - 백업 디렉토리 정리 (선택사항)
    log("🧹 임시 파일 정리 중...");
    // dist-new는 이미 dist로 이동했으므로 없어야 함
    // dist-backup은 다음 배포를 위해 유지하거나 삭제할 수 있음
    // 필요시 주석 해제: removeDir(DIST_BACKUP_DIR);

    log("🎉 배포 완료!");
    process.exit(0);
  } catch (error) {
    log(`❌ 배포 실패: ${error.message}`);
    rollback();

    // 롤백 후 PM2도 이전 버전으로 재시작
    try {
      const rollbackStatus = getPm2Status();
      if (rollbackStatus === "online") {
        log("🔄 롤백된 버전으로 PM2 reload...");
        exec(
          `npx pm2 reload ecosystem.config.js --only "${APP_NAME}" --update-env`
        );
      } else {
        if (rollbackStatus === "stopped") {
          exec(`npx pm2 delete "${APP_NAME}"`);
        }
        log("🔄 롤백된 버전으로 PM2 start...");
        exec(`npx pm2 start ecosystem.config.js --only "${APP_NAME}"`);
      }
    } catch (reloadError) {
      log(`⚠️  PM2 재시작 실패: ${reloadError.message}`);
    }

    process.exit(1);
  }
}

main();
