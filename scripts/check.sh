#!/usr/bin/env bash
# Local disposable verification only. No SSH, production mounts, or Telegram calls.
set -euo pipefail
cd "$(dirname "$0")/.."
network_created=0
redis_created=0
meili_created=0
cleanup() {
  if [[ "$redis_created" == 1 ]]; then docker stop gifory-test-redis >/dev/null; fi
  if [[ "$meili_created" == 1 ]]; then docker stop gifory-test-meili >/dev/null; fi
  if [[ "$network_created" == 1 ]]; then docker network rm gifory-fix-verification >/dev/null; fi
}
trap cleanup EXIT
# Name collisions fail instead of replacing another developer's test services.
docker network create gifory-fix-verification >/dev/null
network_created=1
docker run -d --rm --name gifory-test-redis --network gifory-fix-verification \
  redis:8.6.2-alpine@sha256:c5e375abb885e6b2021c0377879e4890bf76f9065b8922ffc113f2b226b9fc17 \
  redis-server --save '' --appendonly no >/dev/null
redis_created=1
docker run -d --rm --name gifory-test-meili --network gifory-fix-verification \
  -e MEILI_ENV=development -e MEILI_NO_ANALYTICS=true \
  getmeili/meilisearch:v1.42.1@sha256:e13a16ddc45f66fd065b3416230c2669426cfa8907f4a43f14a9c09a17691fa4 >/dev/null
meili_created=1
docker build -t gifory:review-fixes .
docker run --rm --network gifory-fix-verification \
  -e GIFORY_INTEGRATION=1 -e REDIS_HOST=gifory-test-redis -e MEILI_HOST=http://gifory-test-meili:7700 \
  -v "$PWD/tests:/app/tests:ro" gifory:review-fixes npm test
