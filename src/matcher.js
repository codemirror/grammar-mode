class State {
  constructor(stack, context, tokenContext) {
    this.stack = stack
    this.context = this.tokenContext = context
  }

  forward(stream) {
    node: for (let depth = this.stack.length - 1;;) {
      let cur = this.stack[depth]
      this.tokenContext = this.context
      for (let i = 0; i < cur.length; i += 2) {
        let match = cur[i], matched = false, progress = false
        if (!match) matched = true
        else if (stream) progress = (matched = stream.match(match)) && stream.pos > stream.start
        else if (match.multiline) matched = progress = true
        else if (match.test("")) matched = true

        if (matched) {
          this.stack.length = depth
          cur[i + 1](this)
          depth = this.stack.length - 1
          if (progress) return this.tokenContext
          else continue node
        }
      }
      if (depth) depth--
      else depth = this.stack.push(TOKEN) - 1
    }
  }

  token(stream) {
    let startNode = this.stack[this.stack.length - 1]
    let context = this.forward(stream)
    if (stream.eol()) this.forward(null)
    for (; context; context = context.prev)
      if (typeof context.value == "string") return context.value
  }

  pushContext(name, value) {
    this.context = {name, value, prev: this.context}
  }

  copy() {
    return new State(this.stack.slice(), this.context)
  }
}

class GrammarMode {
  constructor(startNode) {
    this.startNode = startNode
  }

  startState() { return new State([this.startNode], null) }

  copyState(state) { return state.copy() }

  token(stream, state) {
    return state.token(stream)
  }

  blankLine(state) {
    return state.forward(null)
  }
}
