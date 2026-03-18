'use strict';

const AlertManager = require('./alert-manager');

let _instance = null;

function _getInstance() {
  if (!_instance) {
    _instance = new AlertManager();
  }
  return _instance;
}

async function emitAlert(event) {
  return _getInstance().emit(event);
}

async function resolveAlert(key, meta = {}) {
  return _getInstance().resolve(key, meta);
}

module.exports = { emitAlert, resolveAlert };
