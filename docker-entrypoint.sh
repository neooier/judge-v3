#!/bin/bash
set -euo pipefail
command_name="${1:-daemon}"
if (( $# )); then shift; fi

prepare_runner() {
  if [[ "${SYZOJ_JUDGE_LANGUAGE_PROFILE:-}" == noi-linux2 ]]; then
    verify-noi-toolchain "${SYZOJ_JUDGE_SANDBOX_ROOTFS_PATH:-/rootfs}"
  fi
  local root="${SYZOJ_JUDGE_CGROUP_ROOT:-/sys/fs/cgroup}"
  if [[ "$root" == /sys/fs/cgroup && "$(cat /proc/self/cgroup)" != '0::/' ]]; then
    echo 'Default Docker runner root requires --cgroupns=private.' >&2; exit 1
  fi
  if [[ ! -f "$root/cgroup.controllers" ]]; then
    echo "Runner requires a cgroup v2 root: $root" >&2; exit 1
  fi
  if [[ ! -w "$root/cgroup.subtree_control" ]]; then
    # Mount only the container's private cgroup namespace; never bind the host hierarchy.
    if [[ "$root" != /sys/fs/cgroup || "$(cat /proc/self/cgroup)" != '0::/' ]]; then
      echo 'A writable delegated cgroup root is required; use a private cgroup namespace.' >&2; exit 1
    fi
    mount -o remount,rw "$root"
  fi
  mkdir -p "${SYZOJ_JUDGE_WORKING_DIRECTORY:-/tmp/working}" "${SYZOJ_JUDGE_BINARY_DIRECTORY:-/tmp/binary}"
}

case "$command_name" in
  daemon)
    exec node /app/lib/daemon -c /app/config/judge-daemon.json "$@" ;;
  runner)
    prepare_runner
    exec node /app/lib/runner -s /app/config/runner-shared.json \
      -i "/app/config/runner-instance-${SYZOJ_JUDGE_RUNNER_INSTANCE:-runner}.json" "$@" ;;
  verify-toolchain)
    exec verify-noi-toolchain "${SYZOJ_JUDGE_SANDBOX_ROOTFS_PATH:-/rootfs}" ;;
  verify-sandbox)
    prepare_runner
    exec node /app/test/docker-integration.js "$@" ;;
  *) exec "$command_name" "$@" ;;
esac
