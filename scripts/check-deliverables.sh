#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/.."
for path in PRD.md README.md AGENTS.md CLAUDE.md db.md \
  prompts/README.md prompts/v1-기획요청.md prompts/v2-방향전환.md \
  prompts/tasks/T1.md docs/위임로그/김태형.md; do
  if [[ ! -f "$path" ]]; then
    echo "제출 산출물 누락: $path" >&2
    exit 1
  fi
done
echo "제출 산출물 확인 완료"
