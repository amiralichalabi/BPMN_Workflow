#!/usr/bin/env bash
# Quick security + versioning checks against a running instance.
# usage: ADMIN_PASSWORD=... bash scripts/smoke.sh [http://localhost:8080]
set -u
BASE=${1:-http://localhost:8080}
PW=${ADMIN_PASSWORD:?set ADMIN_PASSWORD}
JAR=$(mktemp); fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $3, got $2)"; fail=1; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "API without login is rejected"        "$(code $BASE/api/diagrams)" 401
check "POST without X-Studio header rejected" "$(code -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{}')" 400
check "wrong password rejected"              "$(code -X POST $BASE/api/auth/login -H 'X-Studio: 1' -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong-password"}')" 401
check "login ok"                             "$(code -c $JAR -X POST $BASE/api/auth/login -H 'X-Studio: 1' -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$PW\"}")" 200

ID=$(curl -s -b $JAR -X POST $BASE/api/diagrams -H 'X-Studio: 1' -H 'Content-Type: application/json' -d '{"title":"smoke test"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
check "diagram created (v1)"                 "$(code -b $JAR $BASE/api/diagrams/$ID/versions/1)" 200
check "stale save is rejected (409)"         "$(code -b $JAR -X POST $BASE/api/diagrams/$ID/versions -H 'X-Studio: 1' -H 'Content-Type: application/json' -d '{"xml":"x","message":"m","baseVersion":99}')" 409
check "invalid XML is rejected"              "$(code -b $JAR -X POST $BASE/api/diagrams/$ID/versions -H 'X-Studio: 1' -H 'Content-Type: application/json' -d '{"xml":"<not-bpmn/>","message":"m","baseVersion":1}')" 400
check "bogus public token is 404"            "$(code $BASE/api/public/not-a-real-token)" 404
check "security headers present"             "$(curl -sI $BASE/ | grep -ci 'content-security-policy')" 1
exit $fail
