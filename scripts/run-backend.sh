#!/usr/bin/env bash
# Starts MySQL (if not running) and the Spring Boot backend with .env overrides.
set -euo pipefail
cd "$(dirname "$0")/../backend"

MYSQL_SOCK=/tmp/mysql-webox.sock
if [ ! -S "$MYSQL_SOCK" ]; then
  echo "MySQL socket missing — starting MySQL..."
  /Users/anthonyzhi/tools/mysql/bin/mysqld \
    --basedir=/Users/anthonyzhi/tools/mysql \
    --datadir=/Users/anthonyzhi/tools/mysql/data \
    --port=3306 --socket=$MYSQL_SOCK --mysqlx=0 \
    --log-error=/Users/anthonyzhi/tools/mysql/logs/server.log &
  for _ in $(seq 1 30); do [ -S "$MYSQL_SOCK" ] && break; sleep 1; done
fi

export PATH="/Users/anthonyzhi/tools/jdk/jdk-17.0.20.1+1/Contents/Home:/Users/anthonyzhi/tools/maven/bin:$PATH"
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

exec mvn -q spring-boot:run
