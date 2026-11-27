#!/bin/sh
set -eu
# Dedicated disposable names, no host ports, no persistent mounts or production secrets.
network=anka-editable-draft-qa-$$
db=anka-editable-draft-db-$$
wp=anka-editable-draft-wp-$$
cleanup() { docker rm -f "$wp" "$db" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal "$network" >/dev/null
docker run -d --name "$db" --network "$network" --tmpfs /var/lib/mysql -e MARIADB_ROOT_PASSWORD=synthetic-local-only -e MARIADB_DATABASE=wordpress mariadb@sha256:a8992b5e5404d11e03c54a31d0c1bdea3fd116d283aa6d1a627551f29045309b >/dev/null
docker run -d --name "$wp" --network "$network" -v "$PWD:/candidate:ro" -e WORDPRESS_DB_HOST="$db" -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD=synthetic-local-only -e WORDPRESS_DB_NAME=wordpress -e WORDPRESS_CONFIG_EXTRA="define('WP_ENVIRONMENT_TYPE','staging');" wordpress@sha256:9b46af6a41fd0dcb2e5cf85033a6350d05010356847ede1cfcac5cf94292eb26 >/dev/null
i=0
until docker exec "$db" mariadb -h127.0.0.1 -uroot -psynthetic-local-only -e 'SELECT 1' wordpress >/dev/null 2>&1; do
 i=$((i+1)); [ "$i" -lt 30 ] || exit 1; sleep 1
done
# The WordPress entrypoint copies core and writes wp-config after container start.
# Database readiness alone does not mean that WordPress has finished bootstrapping.
i=0
until docker exec "$wp" php -r 'define("WP_INSTALLING",true); require "/var/www/html/wp-load.php"; exit(defined("WP_CONTENT_DIR") ? 0 : 1);' >/dev/null 2>&1; do
 i=$((i+1)); [ "$i" -lt 60 ] || exit 1; sleep 1
done
docker exec "$wp" php -l /candidate/wordpress/anka-drafts/anka-drafts.php
result=$(docker exec "$wp" php /candidate/tools/test-editable-wordpress.php)
printf '%s\n' "$result"
printf '%s\n' "$result" | grep -q '"passed":true'
