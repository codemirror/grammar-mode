class Context {
  constructor(name, value, depth, parent) {
    this.name = name
    this.value = value
    this.depth = depth
    this.parent = parent
  }
}

class State {
  constructor(stack, context) {
    this.stack = stack
    this.context = context
  }

  popContext(depth) {
    while (this.context && this.context.depth > depth)
      this.context = this.context.parent
  }

  forward(stream) {
    this.popContext(this.stack.length - 1)
    node: for (let depth = this.stack.length - 1;;) {
      let cur = this.stack[depth]
      for (let i = 0; i < cur.length; i += 2) {
        let match = cur[i], matched = false, progress = false
        if (!match) matched = true
        else if (stream) progress = (matched = stream.match(match)) && stream.pos > stream.start
        else if (match.multiline) matched = progress = true
        else if (match.test("")) matched = true

        if (matched) {
          if (depth < this.stack.length) {
            this.stack.length = depth
            this.popContext(depth - 1)
          }
          cur[i + 1](this)
          let tokenContext = this.context
          depth = this.stack.length - 1
          if (progress) {
            return tokenContext
          } else {
            this.popContext(depth)
            continue node
          }
        }
      }
      if (depth) depth--
      else depth = this.stack.push(_TOKEN) - 1
    }
  }

  token(stream) {
    let context = this.forward(stream)
    if (stream.eol()) this.forward(null)
    for (; context; context = context.prev)
      if (typeof context.value == "string") return context.value
  }

  pushContext(name, value) {
    this.context = new Context(name, value, this.stack.length - 1, this.context)
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
