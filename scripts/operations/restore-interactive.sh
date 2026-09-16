#!/bin/bash
# The passphrase is entered locally; it is never written to disk or command arguments.
set -euo pipefail
set +x
umask 077
cd -- "$(dirname -- "$0")/../.."
restore_root="$PWD"
if [[ ! -t 0 || $# -ne 1 || ! -f "$1" ]]; then
  echo '터미널에서 실행: bash scripts/operations/restore-interactive.sh backups/백업파일.drmbkp' >&2
  exit 1
fi
export DREAMARY_RESTORE_FILE
DREAMARY_RESTORE_FILE="$(cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"
# Use the already installed CLI so running a drill does not download packages.
restore_cli=''
for candidate in "$HOME"/.npm/_npx/*/node_modules/firebase-tools/lib/bin/firebase.js; do
  if [[ -f "$candidate" ]] && node -e 'process.exit(require(process.argv[1]).version === "15.27.0" ? 0 : 1)' "$(dirname -- "$candidate")/../../package.json"; then
    restore_cli="$candidate"
    break
  fi
done
if [[ -z "$restore_cli" ]]; then
  echo '검증된 Firebase CLI 15.27.0이 필요합니다. 설치 준비를 요청해주세요.' >&2
  exit 1
fi
restore_temp="$(mktemp -d "${TMPDIR:-/tmp}/dreamary-restore-drill.XXXXXX")"
trap 'unset BACKUP_PASSPHRASE; rm -rf -- "$restore_temp"' EXIT
printf '백업에 사용한 암호문구를 입력하세요 (화면에 표시되지 않음): '
IFS= read -r -s BACKUP_PASSPHRASE
printf '\n'
export BACKUP_PASSPHRASE
# The CLI and worker do not receive cloud credentials. Only the local demo can be used.
unset FIREBASE_SERVICE_ACCOUNT_KEY GOOGLE_APPLICATION_CREDENTIALS FIREBASE_TOKEN FIREBASE_CONFIG FIRESTORE_EMULATOR_HOST GCLOUD_PROJECT GOOGLE_CLOUD_PROJECT
export DREAMARY_RESTORE_SOURCE='dreamary-1a9af'
export DREAMARY_RESTORE_WORKER="$restore_root/scripts/operations/restore-drill.cjs"
export TMPDIR="$restore_temp"
cat > "$restore_temp/firestore.rules" <<'RULES'
rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }
RULES
cat > "$restore_temp/firebase.json" <<'JSON'
{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"host":"127.0.0.1","port":8186},"hub":{"host":"127.0.0.1","port":4486},"logging":{"host":"127.0.0.1","port":4586},"ui":{"enabled":false},"singleProjectMode":true}}
JSON
cd -- "$restore_temp"
printf '이 Mac의 임시 DB에서만 복원합니다. 운영 Firebase에는 연결하지 않습니다.\n'
node "$restore_cli" emulators:exec --only firestore --project demo-dreamary-backup-drill --config "$restore_temp/firebase.json" 'node "$DREAMARY_RESTORE_WORKER"'
unset BACKUP_PASSPHRASE
printf '복원 시험이 끝났으며 임시 DB는 종료됐습니다. 결과 기록: %s.restore-check.json\n' "$DREAMARY_RESTORE_FILE"
