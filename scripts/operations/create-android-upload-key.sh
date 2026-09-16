#!/usr/bin/env bash
set -euo pipefail

KEY_DIR="$HOME/Library/Application Support/Dreamary/AndroidSigning"
KEY_FILE="$KEY_DIR/dreamary-upload.jks"
KEY_ALIAS="dreamary-upload"
KEYCHAIN_ACCOUNT="dreamary"
KEYCHAIN_SERVICE="com.dreamary.android.upload"
KEYTOOL="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"

if [[ -f "$KEY_FILE" ]]; then
  security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w >/dev/null
  echo "기존 Android 업로드 키를 유지합니다: $KEY_FILE"
  exit 0
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

upload_password="$(openssl rand -base64 48 | tr -d '\n')"
created=false
cleanup() {
  if [[ "$created" != true ]]; then
    rm -f "$KEY_FILE"
  fi
  unset upload_password
}
trap cleanup EXIT

"$KEYTOOL" -genkeypair \
  -keystore "$KEY_FILE" \
  -storetype PKCS12 \
  -storepass "$upload_password" \
  -keypass "$upload_password" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=Dreamary Upload,O=Dreamary,C=KR" \
  -noprompt >/dev/null

security add-generic-password \
  -a "$KEYCHAIN_ACCOUNT" \
  -s "$KEYCHAIN_SERVICE" \
  -w "$upload_password" \
  -U >/dev/null

chmod 600 "$KEY_FILE"
created=true
echo "Android 업로드 키 생성 완료: $KEY_FILE"
echo "비밀번호는 macOS 키체인 서비스 $KEYCHAIN_SERVICE 에 저장했습니다."
