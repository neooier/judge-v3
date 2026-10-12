'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSandbox, initializeSandbox } = require('simple-sandbox');
const { SandboxStatus } = require('simple-sandbox/lib/interfaces');
const { getLanguage } = require('../lib/languages');

const rootfs = process.env.SYZOJ_JUDGE_SANDBOX_ROOTFS_PATH || '/rootfs';
const cgroupRoot = process.env.SYZOJ_JUDGE_CGROUP_ROOT || '/sys/fs/cgroup';
const cgroup = 'docker-acceptance';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-noi-linux2-'));
fs.chmodSync(temporary, 0o755);
const mount = (src, dst, limit) => ({ src, dst, limit });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function execute(parameter, mounts, cancel) {
    const sandbox = await startSandbox(Object.assign({
        cgroupRoot, cgroup, chroot: rootfs, user: 'nobody', mountProc: true,
        redirectBeforeChroot: false, environments: ['PATH=/usr/bin:/bin', 'HOME=/tmp'], mounts
    }, parameter));
    if (cancel) { await sleep(100); sandbox.stop(); }
    const result = await sandbox.waitForStop();
    await sandbox.waitForCleanedUp();
    assert(!fs.existsSync(path.join(cgroupRoot, sandbox.parameter.cgroup)), 'completed testcase cgroup remains');
    return result;
}

async function compile(name, source, directory) {
    const language = getLanguage(name);
    assert(language, 'language is not registered: ' + name);
    const sourceDirectory = path.join(temporary, directory, 'source');
    const outputDirectory = path.join(temporary, directory, 'binary');
    fs.mkdirSync(sourceDirectory, { recursive: true, mode: 0o755 });
    fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
    fs.chownSync(outputDirectory, 65534, 65534);
    fs.writeFileSync(path.join(sourceDirectory, language.sourceFileName), source);
    const result = await execute(language.compile('/sandbox/1/' + language.sourceFileName, '/sandbox/2', true),
        [mount(sourceDirectory, '/sandbox/1', 0), mount(outputDirectory, '/sandbox/2', -1)]);
    const message = path.join(outputDirectory, 'message.txt');
    assert.strictEqual(result.status, SandboxStatus.OK, name + ' compile status; ' + (fs.existsSync(message) ? fs.readFileSync(message, 'utf8') : ''));
    assert.strictEqual(result.code, 0, name + ' compile failed; ' + (fs.existsSync(message) ? fs.readFileSync(message, 'utf8') : ''));
    return { language, outputDirectory };
}

async function runCompiled(compiled, expected) {
    const work = path.join(compiled.outputDirectory, 'work');
    fs.mkdirSync(work, { mode: 0o755 });
    fs.chownSync(work, 65534, 65534);
    fs.writeFileSync(path.join(work, 'input.txt'), '21\n');
    const result = await execute(compiled.language.run('/sandbox/1', '/sandbox/2', 3000, 64 * 1024 * 1024,
        '/sandbox/2/input.txt', '/sandbox/2/output.txt', '/sandbox/2/error.txt'),
        [mount(compiled.outputDirectory, '/sandbox/1', 0), mount(work, '/sandbox/2', -1)]);
    assert.strictEqual(result.status, SandboxStatus.OK);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(fs.readFileSync(path.join(work, 'output.txt'), 'utf8').trim(), expected);
    console.log('PASS: compile/run ' + compiled.language.name);
}

(async () => {
    await require('./cache-profile')();
    initializeSandbox({ cgroupRoot, cgroup });
    assert(fs.readFileSync('/proc/self/cgroup', 'utf8').includes('/.sandbox-manager'), 'private namespace root manager must move to a leaf');
    assert.strictEqual(getLanguage('java'), undefined, 'NOI profile must not offer absent compilers');
    const cpp = '#include <iostream>\nint main(){int n; std::cin>>n; std::cout<<__GNUC__<<"."<<__GNUC_MINOR__<<":"<<__cplusplus<<":"<<sizeof(void*)<<":"<<n*2<<"\\n";}\n';
    for (const name of ['cpp14', 'cpp-noilinux']) {
        const compiled = await compile(name, cpp, name);
        const headers = execFileSync('/usr/bin/readelf', ['-l', path.join(compiled.outputDirectory, 'a.out')], { encoding: 'utf8' });
        assert(!headers.includes('INTERP'), 'contest C++ program must be statically linked');
        await runCompiled(compiled, '9.3:201402:8:42');
    }
    await runCompiled(await compile('c', '#include <stdio.h>\nint main(){int n;scanf("%d",&n);printf("%d\\n",n*2);}\n', 'c'), '42');
    await runCompiled(await compile('pascal', 'program test; var n:longint; begin readln(n); writeln(n*2); end.\n', 'pascal'), '42');
    const python = 'import sys\nsys.stdout.write(str(int(sys.stdin.readline()) * 2) + "\\n")\n';
    for (const name of ['python2', 'python3']) await runCompiled(await compile(name, python, name), '42');

    const fixture = await compile('c', fs.readFileSync(path.join(__dirname, 'resource-fixture.c'), 'utf8'), 'resources');
    async function resource(mode, overrides, status) {
        const result = await execute(Object.assign({ executable: '/sandbox/1/a.out', parameters: ['fixture', mode],
            workingDirectory: '/sandbox/2', time: 5000, memory: 64 * 1024 * 1024, process: 8 }, overrides),
            [mount(fixture.outputDirectory, '/sandbox/1', 0), mount(fixture.outputDirectory, '/sandbox/2', -1)], mode === 'cancel');
        assert.strictEqual(result.status, status, mode + ' status');
        console.log('PASS: ' + mode + ' ' + JSON.stringify(result));
        return result;
    }
    const peak = await resource('ok', { time: -1, memory: -1 }, SandboxStatus.OK);
    assert(peak.memory >= 8 * 1024 * 1024);
    await resource('loop', { time: 200 }, SandboxStatus.TimeLimitExceeded);
    await resource('memory', { memory: 16 * 1024 * 1024 }, SandboxStatus.MemoryLimitExceeded);
    await resource('child-memory', { memory: 16 * 1024 * 1024 }, SandboxStatus.MemoryLimitExceeded);
    assert.strictEqual((await resource('pids', { process: 4 }, SandboxStatus.OK)).code, 0);
    assert((await resource('cpu', {}, SandboxStatus.OK)).time >= 550000000);
    await resource('cancel', {}, SandboxStatus.Cancelled);
    const leaves = fs.readdirSync(path.join(cgroupRoot, cgroup)).filter(name => fs.statSync(path.join(cgroupRoot, cgroup, name)).isDirectory());
    assert.deepStrictEqual(leaves, []);
    console.log('PASS: Docker private cgroup v2 + NOI Linux 2.0 toolchain acceptance');
})().catch(error => { console.error(error); process.exitCode = 1; });
