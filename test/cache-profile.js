'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const msgpack = require('msgpack-lite');
const { TaskStatus } = require('../lib/interfaces');

function mock(module, value) {
    const filename = require.resolve(module);
    require.cache[filename] = { id: filename, filename, loaded: true, exports: value };
}

module.exports = async function checkCompilerCache() {
    const code = 'int main(){return 0;}';
    const legacy = 'src-cpp14' + crypto.createHash('sha256').update(code).digest('hex');
    let cached = legacy;
    let queued = [];
    mock('../lib/daemon/redis', {
        getCompileLock: async () => async () => {},
        checkBinaryExistance: async name => name === cached
    });
    mock('../lib/daemon/rmq', { runTask: async request => {
        queued.push(request.task);
        return { status: TaskStatus.Done };
    } });
    const { compile } = require('../lib/daemon/judge/compile');
    const first = await compile(code, { name: 'cpp14' }, [], 1);
    assert.strictEqual(queued.length, 1, 'existing legacy cache must not bypass NOI compilation');
    assert.notStrictEqual(first[0], legacy);
    assert.strictEqual(queued[0].binaryName, first[0]);
    cached = first[0];
    await compile(code, { name: 'cpp14' }, [], 1);
    assert.strictEqual(queued.length, 1, 'matching NOI cache should be reused');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cache-profile-'));
    mock('../lib/runner/config', { globalConfig: { binaryDirectory: directory } });
    mock('../lib/runner/redis', { get: async () => msgpack.encode({ language: 'cpp14', code }) });
    const { fetchBinary } = require('../lib/runner/executable');
    await assert.rejects(fetchBinary(legacy), /different compiler profile/);
    fs.rmdirSync(directory);
    console.log('PASS: legacy cache recompiles under NOI, matching cache reuses, mismatched runner metadata rejects');
};

if (require.main === module) {
    module.exports().catch(error => { console.error(error); process.exitCode = 1; });
}
