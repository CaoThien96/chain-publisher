'use strict'

const assert = require('assert')
const child_process = require('child_process')
const path = require('path')
const {Deferral} = require('@trop/gear')

describe('quick start', () => {
    it('run a worker in 15s', async () => {
        let [workerProcess, workerResultPromise] = startWorkerProcess()
        let timer = setTimeout(() => workerProcess.kill(), 15000)
        let [exitCode, signalCode] = await workerResultPromise

        clearTimeout(timer)
        assert.strictEqual(exitCode, null)
        assert.strictEqual(signalCode, 'SIGTERM')
    })
})

function startWorkerProcess() {
    let workerFile = path.join(__dirname, 'WalletSample.js')
    let workerProcess = child_process.spawn('node', [workerFile], {
        stdio: 'inherit'
    })
    let defer = new Deferral()

    workerProcess.on('exit', (exitCode, signalCode) => {
        defer.resolve([exitCode, signalCode])
    })

    return [workerProcess, defer.promise]
}
