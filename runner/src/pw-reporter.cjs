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
    this.stepStartAt = new Map()
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
    const index = this.stepCount
    this.stepStartAt.set(this._stepKey(step), {
      index,
      startedAt: new Date().toISOString(),
    })
    this._emit('step-begin', {
      index,
      title: step.title,
      line: step.location?.line ?? null,
    })
  }

  onStepEnd(_test, _result, step) {
    if (!this._isTopLevelApi(step)) return
    const key = this._stepKey(step)
    const meta = this.stepStartAt.get(key)
    const index = meta ? meta.index : this.stepCount
    const startedAt = meta ? meta.startedAt : new Date().toISOString()
    this.stepStartAt.delete(key)
    this._emit('step-end', {
      index,
      title: step.title,
      line: step.location?.line ?? null,
      durationMs:
        typeof step.duration === 'number' ? Math.round(step.duration) : null,
      status: step.error ? 'failed' : 'passed',
      errorMessage: step.error?.message ?? null,
      errorStack: step.error?.stack ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
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

  _stepKey(step) {
    // step é uma instância e identidade única durante o run; mas como
    // serializamos via JSON, usamos uma chave estável (title+line+startTime).
    const line = step.location?.line ?? 0
    const ts = step.startTime ? step.startTime.getTime() : 0
    return `${line}:${ts}:${step.title}`
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
