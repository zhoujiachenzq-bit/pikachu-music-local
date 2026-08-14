#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="v0.2.1"
REPO_URL="https://github.com/zhoujiachenzq-bit/pikachu-music-local.git"
APP_DIR="/opt/zqmusic-releases/${VERSION}"
DATA_DIR="/opt/zqmusic-data"
DB_FILE="${DATA_DIR}/pikachu-music.sqlite"
BACKUP_DIR="/opt/zqmusic-backups"
APP_CONTAINER="zqmusic-app"
IMAGE="zqmusic:${VERSION#v}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK_CONTAINER="${APP_CONTAINER}-rollback-${STAMP}"

if [[ ${EUID} -ne 0 ]]; then
  echo "请使用 sudo bash deploy/tencent-v0.2.1.sh 运行。" >&2
  exit 1
fi

for command in docker git curl sqlite3; do
  command -v "${command}" >/dev/null || { echo "缺少命令：${command}" >&2; exit 1; }
done
docker inspect "${APP_CONTAINER}" >/dev/null 2>&1 || { echo "找不到当前容器 ${APP_CONTAINER}。" >&2; exit 1; }
[[ -f "${DB_FILE}" ]] || { echo "找不到数据库 ${DB_FILE}。" >&2; exit 1; }

if [[ -e "${APP_DIR}" ]]; then
  echo "发布目录已存在：${APP_DIR}。为避免覆盖，请先人工核对并改名。" >&2
  exit 1
fi

install -d -o root -g root -m 0755 "$(dirname "${APP_DIR}")"
git clone --depth 1 --branch "${VERSION}" "${REPO_URL}" "${APP_DIR}"
git -C "${APP_DIR}" diff --quiet
[[ "$(git -C "${APP_DIR}" describe --tags --exact-match)" == "${VERSION}" ]]

docker build --pull --tag "${IMAGE}" "${APP_DIR}"

install -d -o root -g root -m 0700 "${BACKUP_DIR}"
BACKUP_FILE="${BACKUP_DIR}/pikachu-music-pre-${VERSION#v}-${STAMP}.sqlite"
sqlite3 "${DB_FILE}" ".timeout 5000" ".backup '${BACKUP_FILE}'"
[[ "$(sqlite3 "${BACKUP_FILE}" 'PRAGMA integrity_check;')" == "ok" ]] || { echo "SQLite 备份完整性检查失败。" >&2; exit 1; }
chmod 0600 "${BACKUP_FILE}"
echo "SQLite backup integrity: ok (${BACKUP_FILE})"

mapfile -t CURRENT_NETWORKS < <(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "${APP_CONTAINER}" | sed '/^$/d')
PRESERVE_NAMES=(
  GO_MUSIC_API_URL REGISTRATION_MODE REGISTRATION_INVITE_CODE SOURCE_MAX_RESPONSE_BYTES MAX_IMPORT_TRACKS
  RATE_REGISTER_IP_DAILY RATE_REGISTER_GLOBAL_HOURLY RATE_LOGIN_ACCOUNT_15M RATE_LOGIN_IP_15M
  RATE_SEARCH_USER_MINUTE RATE_SEARCH_IP_MINUTE RATE_RESOLVE_USER_MINUTE RATE_RESOLVE_IP_MINUTE
  RATE_IMPORT_USER_DAILY RATE_IMPORT_IP_DAILY RATE_RECOMMENDATION_USER_DAILY RATE_LISTENING_USER_MINUTE RATE_BACKUP_USER_HOURLY
)
ENV_ARGS=()
for name in "${PRESERVE_NAMES[@]}"; do
  value="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${APP_CONTAINER}" | sed -n "s/^${name}=//p" | head -n 1)"
  [[ -n "${value}" ]] && ENV_ARGS+=(--env "${name}=${value}")
done

RUN_ARGS=(
  docker run --detach --name "${APP_CONTAINER}" --restart unless-stopped --init --stop-timeout 20
  --publish 127.0.0.1:3000:3000
  --mount "type=bind,src=${DATA_DIR},dst=/var/data"
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m
  --cap-drop ALL --security-opt no-new-privileges:true
  --memory 768m --memory-swap 768m --cpus 1.5 --pids-limit 200
  --log-opt max-size=10m --log-opt max-file=3
  --label "cn.zqmusic.release=${VERSION}"
  --env NODE_ENV=production --env HOST=0.0.0.0 --env PORT=3000
  --env PIKACHU_DB_PATH=/var/data/pikachu-music.sqlite
  --env COOKIE_SECURE=true --env APP_ORIGIN=https://zqmusic.cn
  --env TRUST_PROXY_HOPS=1
)
if [[ ${#CURRENT_NETWORKS[@]} -gt 0 ]]; then RUN_ARGS+=(--network "${CURRENT_NETWORKS[0]}"); fi
RUN_ARGS+=("${ENV_ARGS[@]}" "${IMAGE}")

CUTOVER_STARTED=0
OLD_RENAMED=0
NEW_HEALTHY=0
rollback_on_error() {
  status=$?
  if [[ ${status} -ne 0 && ${CUTOVER_STARTED} -eq 1 && ${NEW_HEALTHY} -eq 0 ]]; then
    echo "部署未通过健康检查，正在恢复旧容器 ${ROLLBACK_CONTAINER}。" >&2
    if [[ ${OLD_RENAMED} -eq 1 ]] && docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then docker rm --force "${APP_CONTAINER}" >/dev/null 2>&1 || true; fi
    if [[ ${OLD_RENAMED} -eq 1 ]] && docker inspect "${ROLLBACK_CONTAINER}" >/dev/null 2>&1; then
      docker rename "${ROLLBACK_CONTAINER}" "${APP_CONTAINER}" || true
      docker start "${APP_CONTAINER}" >/dev/null || true
    elif docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then
      docker start "${APP_CONTAINER}" >/dev/null || true
    fi
  fi
  exit "${status}"
}
trap rollback_on_error EXIT

CUTOVER_STARTED=1
docker stop "${APP_CONTAINER}"
docker rename "${APP_CONTAINER}" "${ROLLBACK_CONTAINER}"
OLD_RENAMED=1
"${RUN_ARGS[@]}"
for ((index=1; index<${#CURRENT_NETWORKS[@]}; index++)); do docker network connect "${CURRENT_NETWORKS[index]}" "${APP_CONTAINER}"; done

for attempt in {1..40}; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/tmp/zqmusic-health.json; then NEW_HEALTHY=1; break; fi
  sleep 2
done
[[ ${NEW_HEALTHY} -eq 1 ]] || { docker logs --tail 120 "${APP_CONTAINER}" >&2 || true; false; }

[[ "$(sqlite3 "${DB_FILE}" 'PRAGMA integrity_check;')" == "ok" ]]
curl --fail --silent --show-error https://zqmusic.cn/api/health
echo
docker inspect --format 'container={{.Name}} image={{.Config.Image}} readonly={{.HostConfig.ReadonlyRootfs}} pids={{.HostConfig.PidsLimit}} memory={{.HostConfig.Memory}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${APP_CONTAINER}"
echo "v0.2.1 部署成功。旧容器保留为 ${ROLLBACK_CONTAINER}，确认登录、收藏、歌单和播放后再人工删除。"
trap - EXIT
