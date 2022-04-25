'use strict'

const assert = require('assert')
const child_process = require('child_process')
const path = require('path')
const { Deferral } = require('@trop/gear')
const storage = require('node-persist');
const { default: fetch } = require('node-fetch')
const { expect } = require('chai')

const BANK_ADDRESS = '0xc4ffFBf8394b99c383846aA9b0EAf4A8F96Dea8F'

describe('quick start', () => {
    it('run a SfarmExample in 30s', async () => {
        let [workerProcess, workerResultPromise] = _startWorkerProcess('SfarmExample.js')
        let timer = setTimeout(() => workerProcess.kill(), 30 * 1000)
        let [exitCode, signalCode] = await workerResultPromise
        const [balances, balanceCompare] = await Promise.all([_getBalances(), _getBalancesFromApi()])
        const [liquidity, liquidityCompare] = await Promise.all([
            _getLiquidity(),
            _getLiquidityFromApi()
        ])
        clearTimeout(timer)

        assert.deepEqual(balances, balanceCompare)

        assert.equal(liquidity?.length, liquidityCompare?.length)

        expect(liquidity).to.have.deep.members(liquidityCompare)
    })
})

async function _getBalances() {
    await storage.init();

    let balances = {}
    await storage.forEach(async function (datum) {
        // use datum.key and datum.value
        const key = datum.key
        const value = datum.value
        const [prefix, address, token] = key.split(',')
        if (prefix == 'balances' && address == BANK_ADDRESS && value != '0') {
            balances[token] = value
        }
    });
    return balances
}

async function _getBalancesFromApi() {
    const res = await fetch('https://test-api.lz.finance/sfarm/sfarm/balance').then(res => res.json())
    const resultCompare = res?.data || {}
    return resultCompare
}

async function _getLiquidity() {
    await storage.init();
    let balances = []
    let liquidities = {}
    await storage.forEach(async function (datum) {
        // use datum.key and datum.value
        const key = datum.key
        const value = datum.value
        const [prefix, address, token] = key.split(',')
        if (prefix == 'balances' && address != BANK_ADDRESS && value != '0') {
            balances.push({
                key,
                balance: value,
                address,
                token
            })
        }
        if (prefix == 'liquidity' && address != BANK_ADDRESS) {
            liquidities[key] = value
        }
    });

    const ret = (balances || [])
        .filter(s => !!s && s.balance != '0')
        .map(({ address, token, balance }) => {
            const value = {
                address,
                token,
                balance,
            }
            const liq = liquidities[['liquidity', address, token].join(',')]
            if (liq && liq?.liquidity?.txIn) {
                value.txIn = liq?.liquidity?.txIn
            }
            if (liq && liq?.liquidity?.txOut) {
                value.txOut = liq?.liquidity?.txOut
            }
            return value
        })

    return ret
}

async function _getLiquidityFromApi() {
    const res = await fetch('https://test-api.lz.finance/sfarm/sfarm/liquidity').then(res => res.json())
    const resultCompare = res?.data || {}
    return resultCompare
}

function _startWorkerProcess(name) {
    let workerFile = path.join(__dirname, name || 'WalletSample.js')
    let workerProcess = child_process.spawn('node', [workerFile], {
        stdio: 'inherit'
    })
    let defer = new Deferral()

    workerProcess.on('exit', (exitCode, signalCode) => {
        defer.resolve([exitCode, signalCode])
    })

    return [workerProcess, defer.promise]
}
