#!/usr/bin/env bash
# Décode le paquet de code, masque les noms sensibles dans les journaux, lance la tâche.
set -euo pipefail
JOB="${1:?usage: run.sh <job>}"
: "${PAYLOAD_KEY:?PAYLOAD_KEY manquant}"
rm -rf app && mkdir app
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in payload.enc -pass env:PAYLOAD_KEY | tar -xz -C app
while IFS= read -r m; do [ -n "$m" ] && echo "::add-mask::$m"; done < app/.masks
cd app
env | grep -E '^(GEMINI_API_KEY[A-Z0-9_]*|MISTRAL_API_KEY[0-9_]*|GROQ_API_KEY|GROQ_MODEL|XAI_API_KEY|XAI_MODEL|TAVILY_API_KEY|CLOUDINARY_[A-Z_]+)=.+' > .env || true
if [ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]; then
  mkdir -p config
  printf '%s' "$FIREBASE_SERVICE_ACCOUNT" > config/service-account-key.json
  cp config/service-account-key.json serviceAccountKey.json
  printf "FIREBASE_SERVICE_ACCOUNT='%s'\n" "$(printf '%s' "$FIREBASE_SERVICE_ACCOUNT" | tr -d '\n')" >> .env
fi
CMD="$(node -e 'const j=require("./.jobs.json")[process.argv[1]]; if(!j){process.exit(2)} console.log(j.cmd)' "$JOB")"
MODE="$(node -e 'console.log(require("./.jobs.json")[process.argv[1]].mode)' "$JOB")"
if [ "$MODE" = "full" ]; then
  npm ci --no-audit --no-fund --loglevel=error
  npx playwright install --with-deps chromium > /dev/null 2>&1
fi
export TZ=Europe/Paris
bash -c "$CMD"
