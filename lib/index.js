'use strict'

module.exports = {
    startWorker: require('./start-worker'),
    accumulationConsumerFactory: require('./factory/accumulation-consumer'),
    chainlogProcessorConfig: require('./chainlog-processor-config'),
}
