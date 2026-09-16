#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "사용법: bash scripts/operations/sign-android-bundle.sh <입력 AAB> <출력 AAB>" >&2
  exit 2
fi

INPUT_AAB="$1"
OUTPUT_AAB="$2"
KEY_FILE="$HOME/Library/Application Support/Dreamary/AndroidSigning/dreamary-upload.jks"
KEY_ALIAS="dreamary-upload"
KEYCHAIN_ACCOUNT="dreamary"
KEYCHAIN_SERVICE="com.dreamary.android.upload"
JARSIGNER="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/jarsigner"

if [[ ! -f "$INPUT_AAB" ]]; then
  echo "입력 AAB를 찾을 수 없습니다." >&2
  exit 1
fi
if [[ ! -f "$KEY_FILE" ]]; then
  echo "Android 업로드 키가 없습니다. 먼저 create-android-upload-key.sh를 실행하세요." >&2
  exit 1
fi
if [[ "$INPUT_AAB" == "$OUTPUT_AAB" ]]; then
  echo "입력 파일과 출력 파일은 달라야 합니다." >&2
  exit 1
fi

upload_password="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w)"
trap 'unset upload_password' EXIT

cp "$INPUT_AAB" "$OUTPUT_AAB"
"$JARSIGNER" \
  -keystore "$KEY_FILE" \
  -storetype PKCS12 \
  -storepass "$upload_password" \
  -keypass "$upload_password" \
  -sigalg SHA256withRSA \
  -digestalg SHA-256 \
  "$OUTPUT_AAB" "$KEY_ALIAS" >/dev/null

# Google Play upload keys are intentionally self-signed. `-strict` treats that
# expected certificate chain as an error even when every bundle entry verifies.
"$JARSIGNER" -verify "$OUTPUT_AAB" >/dev/null
chmod 600 "$OUTPUT_AAB"
echo "서명된 Android App Bundle 생성 완료: $OUTPUT_AAB"
shasum -a 256 "$OUTPUT_AAB"
