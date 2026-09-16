#!/bin/bash
# Run in a local terminal. Never enter the passphrase in chat or command arguments.
set -euo pipefail
set +x
cd -- "$(dirname -- "$0")/../.."
umask 077
if [[ ! -t 0 ]]; then
  echo '터미널에서 직접 실행해주세요.' >&2
  exit 1
fi
trap 'unset BACKUP_PASSPHRASE backup_confirmation' EXIT
printf '백업 암호문구를 입력하세요 (20자 이상, 화면에 표시되지 않음): '
IFS= read -r -s BACKUP_PASSPHRASE
printf '\n'
if [[ ${#BACKUP_PASSPHRASE} -lt 20 ]]; then
  echo '20자 이상의 암호문구가 필요합니다.' >&2
  exit 1
fi
printf '같은 암호문구를 다시 입력하세요: '
IFS= read -r -s backup_confirmation
printf '\n'
if [[ "$BACKUP_PASSPHRASE" != "$backup_confirmation" ]]; then
  echo '두 입력이 다릅니다. 백업을 실행하지 않았습니다.' >&2
  exit 1
fi
unset backup_confirmation
export BACKUP_PASSPHRASE
mkdir -p backups
backup_file="backups/dreamary-1a9af-$(date -u +%Y%m%dT%H%M%SZ).drmbkp"
printf '운영 Firestore를 읽어 암호화합니다. 최대 10,000개 문서이며 운영 데이터는 수정하지 않습니다.\n'
node scripts/operations/backup.cjs --project dreamary-1a9af --action export --file "$backup_file" --max-docs 10000
unset BACKUP_PASSPHRASE
printf '암호화 파일 생성·로컬 무결성 검증 완료: %s/%s\n' "$PWD" "$backup_file"
printf '격리된 DB 복원 시험과 Google Drive 업로드는 별도 단계입니다. 기존 백업은 아직 삭제하지 마세요.\n'
