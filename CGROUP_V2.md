# cgroup v2 deployment

The runner uses the `neooier/simple-sandbox` fork pinned to an exact Git commit in
`package.json` and `yarn.lock`. Publish the sandbox commit before building the judge
on another machine. Yarn Classic does not apply npm `overrides`.

## Host requirements

- Linux with the unified cgroup v2 hierarchy and `cpu`, `memory`, `pids` controllers.
- `memory.peak` (normally Linux 5.19+) and `memory.swap.max` must be available.
- A writable delegated subtree. The root and every intermediate parent must be
  able to enable all three controllers. Configuration errors stop the runner
  before it consumes queue work.
- Root privileges for the existing mount, network and PID namespace sandbox.
- Node 10 remains the runtime of this change. Native compilation needs Python 3,
  a C++17 compiler, make and `libfmt-dev`.

`SandboxCgroupRoot` (or `SYZOJ_JUDGE_CGROUP_ROOT`) selects the absolute delegated
root. `SandboxCgroup` (or `SYZOJ_JUDGE_CGROUP`) is a relative stable parent name,
such as `syzoj-1`. Each execution creates a fresh random leaf under that parent.
The default `/sys/fs/cgroup` is only suitable for a host where the caller owns
that hierarchy; use explicit delegation on systemd hosts.

## systemd service

For a service that starts the runner directly, use `Delegate=yes` and point the
configuration at its delegated subtree. A wrapper can discover the service path:

```sh
#!/bin/sh
set -eu
root="/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)"
export SYZOJ_JUDGE_CGROUP_ROOT="$root"
exec /usr/bin/node /opt/judge-v3/lib/runner/index.js \
  -i /opt/judge-v3/runner-instance-config.json \
  -s /opt/judge-v3/runner-shared-config.json
```

```ini
[Service]
Type=simple
User=root
WorkingDirectory=/opt/judge-v3
Delegate=yes
ExecStart=/opt/judge-v3/start-runner.sh
```

The sandbox moves its own manager process from the delegated root into
`.sandbox-manager` before enabling controllers. It refuses to move unrelated
processes. Additional service processes must already live in separate leaves.
This satisfies the cgroup v2 no-internal-process rule.

```text
judge-runner.service/             delegated root, controllers enabled
  .sandbox-manager/              Node runner
  syzoj-1/                       stable empty parent, controllers enabled
    <random>/                    one execution, limits and counters
```

## Docker

The Dockerfiles install the native build dependencies; they do not grant cgroup
delegation. A read-only `/sys/fs/cgroup` mount cannot run this sandbox. Provision
an isolated writable subtree with the three controllers from the host/container
manager and pass its container-visible path through `SYZOJ_JUDGE_CGROUP_ROOT`.
The existing sandbox also needs namespace/mount privileges. Do not bind the
entire host hierarchy writable as a shortcut. Validate your container manager's
delegation separately from an image build.

## Acceptance

Run the sandbox checkout's `yarn test:integration` as root with
`SANDBOX_TEST_CGROUP_ROOT` pointing at a dedicated delegated subtree. The tests
exercise nested controller propagation, unlimited limits, memory peak, TLE,
OOM/MLE, `pids.max`, aggregate parent/child CPU, cancellation and failed-start
cleanup. Missing delegation is an error, not a skipped test.

Each sandbox preserves the original 25 percent native memory allowance; the
reported peak is compared against the nominal judge limit. A cgroup OOM event
also classifies the run as MLE. `memory.oom.group` prevents a child OOM from leaving
its parent running until TLE. CPU time remains in nanoseconds. Completion waits
for the testcase cgroup to be removed; cleanup failures are reported.

Real queue/database/rootfs judging and Fedora/systemd deployment still require
acceptance on the destination machine.

References: [kernel cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html),
[systemd delegation](https://systemd.io/CGROUP_DELEGATION/).
