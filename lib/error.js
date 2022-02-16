'use strict'

class ChainPublisherError extends Error {
    constructor(message, source=undefined) {
        super(message)
        this.name = 'ChainBackendError'
        this.source = source
    }
}

module.exports = {
    ChainPublisherError
}
