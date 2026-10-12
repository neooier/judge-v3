#!/bin/sh
set -eu
root=${1:-/rootfs}
test -f "$root/etc/noi-linux2-toolchain.json"
grep -q '^VERSION_ID="20.04"$' "$root/etc/os-release"
test "$(chroot "$root" /usr/bin/gcc-9 -dumpfullversion)" = 9.3.0
test "$(chroot "$root" /usr/bin/g++-9 -dumpfullversion)" = 9.3.0
test "$(chroot "$root" /usr/bin/g++-9 -dumpmachine)" = x86_64-linux-gnu
test "$(chroot "$root" /usr/bin/fpc -iV)" = 3.0.4
chroot "$root" /usr/bin/python2 --version 2>&1 | grep -q '^Python 2\.7\.'
chroot "$root" /usr/bin/python3 --version | grep -q '^Python 3\.8\.'
printf '%s\n' 'NOI Linux 2.0 toolchain verified: Ubuntu 20.04, GCC/G++ 9.3.0, FPC 3.0.4, Python 2.7/3.8, x86_64'
