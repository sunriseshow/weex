'use strict'

var utils = require('../utils')
var logger = require('../logger')

require('httpurl')

var jsonpCnt = 0

function _jsonp(config, callback, progressCallback) {
  var cbName = 'jsonp_' + (++jsonpCnt)
  var script, url, head

  if (!config.url) {
    logger.error('config.url should be set in _jsonp for \'fetch\' API.')
  }

  global[cbName] = (function (cb) {
    return function (response) {
      callback(response)
      delete global[cb]
    }
  })(cbName)

  script = document.createElement('script')
  try {
    url = lib.httpurl(config.url)
  } catch (err) {
    logger.error('invalid config.url in _jsonp for \'fetch\' API: '
      + config.url)
  }
  url.params.callback = cbName
  script.type = 'text/javascript'
  script.src = url.toString()
  // script.onerror is not working on IE or safari.
  // but they are not considered here.
  script.onerror = (function (cb) {
    return function (err) {
      logger.error('unexpected error in _jsonp for \'fetch\' API', err)
      callback(err)
      delete global[cb]
    }
  })(cbName)
  head = document.getElementsByTagName('head')[0]
  head.insertBefore(script, null)
}

function _xhr(config, callback, progressCallback) {
  var xhr = new XMLHttpRequest()
  xhr.responseType = config.type
  xhr.open(config.method, config.url, true)

  xhr.onload = function (res) {
    callback({
      status: xhr.status,
      ok: xhr.status >= 200 && xhr.status < 300,
      statusText: xhr.statusText,
      data: xhr.response,
      headers: xhr.getAllResponseHeaders().split('\n')
        .reduce(function (obj, headerStr) {
          var headerArr = headerStr.match(/(.+): (.+)/)
          if (headerArr) {
            obj[headerArr[1]] = headerArr[2]
          }
          return obj
        }, {})
    })
  }

  if (progressCallback) {
    xhr.onprogress = function (e) {
      progressCallback({
        readyState: xhr.readyState,
        status: xhr.status,
        length: e.loaded,
        total: e.total,
        statusText: xhr.statusText,
        headers: xhr.getAllResponseHeaders().split('\n')
          .reduce(function (obj, headerStr) {
            var headerArr = headerStr.match(/(.+): (.+)/)
            if (headerArr) {
              obj[headerArr[1]] = headerArr[2]
            }
            return obj
          }, {})
      })
    }
  }

  xhr.onerror = function (err) {
    logger.error('unexpected error in _xhr for \'fetch\' API', err)
    callback(new Error('unexpected error in _xhr for \'fetch\' API'))
  }

  xhr.send(config.body)
}

var stream = {

  /**
   * sendHttp
   * Note: This API is deprecated. Please use stream.fetch instead.
   * send a http request through XHR.
   * @deprecated
   * @param  {obj} params
   *  - method: 'GET' | 'POST',
   *  - url: url requested
   * @param  {string} callbackId
   */
  sendHttp: function (param, callbackId) {
    if (typeof param === 'string') {
      try {
        param = JSON.parse(param)
      } catch (e) {
        return
      }
    }
    if (typeof param !== 'object' || !param.url) {
      return logger.error('invalid config or invalid config.url for sendHttp API')
    }
    
    var sender = this.sender
    var method = param.method || 'GET'
    var xhr = new XMLHttpRequest()
    xhr.open(method, param.url, true)
    xhr.onload = function () {
      sender.performCallback(callbackId, this.responseText)
    }
    xhr.onerror = function (error) {
      return logger.error('unexpected error in sendHttp API', error)
      sender.performCallback(callbackId, new Error('unexpected error in sendHttp API'))
    }
    xhr.send()
  },

  /**
   * fetch
   * use stream.fetch to request for a json file, a plain text file or
   * a arraybuffer for a file stream. (You can use Blob and FileReader
   * API implemented by most modern browsers to read a arraybuffer.)
   * @param  {object} options config options
   *   - method {string} 'GET' | 'POST'
   *   - headers {obj}
   *   - url {string}
   *   - mode {string} 'cors' | 'no-cors' | 'same-origin' | 'navigate'
   *   - body
   *   - type {string} 'json' | 'jsonp' | 'text'
   * @param  {string} callbackId
   * @param  {string} progressCallbackId
   */
  fetch: function (options, callbackId, progressCallbackId) {

    var DEFAULT_METHOD = 'GET'
    var DEFAULT_MODE = 'cors'
    var DEFAULT_TYPE = 'text'

    var methodOptions = ['GET', 'POST']
    var modeOptions = ['cors', 'no-cors', 'same-origin', 'navigate']
    var typeOptions = ['text', 'json', 'jsonp', 'arraybuffer']

    var fallback = false  // fallback from 'fetch' API to XHR.
    var sender = this.sender

    var config = utils.extend({}, options)

    // validate options.method
    if (typeof config.method === 'undefined') {
      config.method = DEFAULT_METHOD
      logger.warn('options.method for \'fetch\' API has been set to '
        + 'default value \'' + config.method + '\'')
    } else if (methodOptions.indexOf((config.method + '')
        .toUpperCase()) === -1) {
      return logger.error('options.method \''
        + config.method
        + '\' for \'fetch\' API should be one of '
        + methodOptions + '.')
    }

    // validate options.url
    if (!config.url) {
      return logger.error('options.url should be set for \'fetch\' API.')
    }

    // validate options.mode
    if (typeof config.mode === 'undefined') {
      config.mode = DEFAULT_MODE
    } else if (modeOptions.indexOf((config.mode + '').toLowerCase()) === -1) {
      return logger.error('options.mode \''
        + config.mode
        + '\' for \'fetch\' API should be one of '
        + modeOptions + '.')
    }

    // validate options.type
    if (typeof config.type === 'undefined') {
      config.type = DEFAULT_TYPE
      logger.warn('options.type for \'fetch\' API has been set to '
        + 'default value \'' + config.type + '\'.')
    } else if (typeOptions.indexOf((config.type + '').toLowerCase()) === -1) {
      return logger.error('options.type \''
          + config.type
          + '\' for \'fetch\' API should be one of '
          + typeOptions + '.')
    }

    var _callArgs = [config, function (res) {
      sender.performCallback(callbackId, res)
    }]
    if (progressCallbackId) {
      _callArgs.push(function (res) {
        // Set 'keepAlive' to true for sending continuous callbacks
        sender.performCallback(progressCallbackId, res, true)
      })
    }

    if (config.type === 'jsonp') {
      _jsonp.apply(this, _callArgs)
    } else {
      _xhr.apply(this, _callArgs)
    }
  }

}

stream._meta = {
  stream: [{
    name: 'sendHttp',
    args: ['object', 'function']
  }, {
    name: 'fetch',
    args: ['object', 'function', 'function']
  }]
}

module.exports = stream