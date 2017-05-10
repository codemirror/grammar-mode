class Context {
  constructor(name, value, depth, parent) {
    this.name = name
    this.value = value
    this.depth = depth
    this.parent = parent
  }
}

class LineEndStream {
  constructor() {
    this.pos = 0
  }

  match(re) {
    if (re.multiline) {
      this.pos = 1
      return true
    }
    return re.test("")
  }

  get start() { return 0 }
}

function matchEdge(node, stream) {
  for (let i = 0; i < node.length; i += 2) {
    let match = node[i]
    if (!match || stream.match(match)) return node[i + 1]
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
    for (let depth = this.stack.length - 1;;) {
      let edge = matchEdge(this.stack[depth], stream)
      if (edge) {
        this.stack.length = depth
        this.popContext(depth - 1)
        edge(this)
        depth = this.stack.length - 1
        if (stream.pos > stream.start) {
          return this.context
        } else {
          this.popContext(depth)
          continue
        }
      }
      if (depth) depth--
      else depth = this.stack.push(_TOKEN) - 1
    }
  }

  token(stream) {
    let context = this.forward(stream)
    if (stream.eol()) this.forward(new LineEndStream)
    for (; context; context = context.prev)
      if (typeof context.value == "string") return context.value
  }

  push(node) {
    this.stack[this.stack.length] = node
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
