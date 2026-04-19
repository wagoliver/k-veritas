/**
 * Reporter customizado do Playwright que emite eventos no stdout com
 * prefixo ::KV_EVT:: pra o worker parsear em streaming.
 *
 * Filtra pra apenas eventos category='pw:api' top-level — aninhados
 * (locator.wait internal, etc) são ruído pra nossa UI.
 *
 * CommonJS obrigatório: Playwright carrega reporters como require().
 */

class StreamReporter {
  constructor() {
    this.stepCount = 0
  }

  onBegin(_config, suite) {
    const totalTests = suite.allTests().length
    this._emit('run-begin', { totalTests })
  }

  onTestBegin(test) {
    this._emit('test-begin', {
      title: test.title,
      file: test.location?.file,
      line: test.location?.line,
    })
  }

  onStepBegin(_test, _result, step) {
    if (!this._isTopLevelApi(step)) return
    this.stepCount++
    this._emit('step-begin', {
      index: this.stepCount,
      title: step.title,
      line: step.location?.line ?? null,
    })
  }

  onStepEnd(_test, _result, step) {
    if (!this._isTopLevelApi(step)) return
    this._emit('step-end', {
      title: step.title,
      line: step.location?.line ?? null,
      errorMessage: step.error?.message ?? null,
    })
  }

  onTestEnd(test, result) {
    this._emit('test-end', {
      title: test.title,
      status: result.status,
      duration: result.duration,
    })
  }

  _isTopLevelApi(step) {
    if (step.category !== 'pw:api') return false
    // Filtra chamadas aninhadas (ex: locator.click internamente chama
    // locator.waitFor) — só contamos a chamada de maior nível.
    return step.parent == null || step.parent.category !== 'pw:api'
  }

  _emit(type, payload) {
    try {
      process.stdout.write(
        `::KV_EVT::${JSON.stringify({ type, ...payload })}\n`,
      )
    } catch {
      // best-effort; não deixa o reporter estourar
    }
  }
}

module.exports = StreamReporter
