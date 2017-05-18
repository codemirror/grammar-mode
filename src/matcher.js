class Context {
  constructor(name, value, depth, parent) {
    this.name = name
    this.value = value
    this.depth = depth
    this.parent = parent
  }
}

let charsTaken = 0
let nullMatch = /(?=.)/.exec(" ")

function matchEdge(node, str) {
  for (let i = 1; i < node.length; i++) {
    let edge = node[i]
    if (edge.lookahead) throw new Error("FIXME")
    let match = edge.match ? edge.match.exec(str) : nullMatch
    if (match) {
      charsTaken = match[0].length
      return edge
    }
  }
}

let tokenValue = null

class State {
  constructor(stack, context) {
    this.stack = stack
    this.context = context
  }

  // FIXME profile whether this hack is actually faster than keeping an array
  runMaybeInner(str, maxSpeculate) {
    let nodePos = this.stack.length - 1, node = this.stack[nodePos], edge = matchEdge(node, str)
    if (!edge) {
      if (maxSpeculate == 0) return -1
      maxSpeculate--
      edge = node[node.length - 1]
      charsTaken = 0
    }
    this.stack.pop()
    this.popContext()
    tokenValue = edge.apply(this)
    if (charsTaken > 0) return charsTaken
    let inner = this.runMaybeInner(str, maxSpeculate)
    if (inner == -1) {
      if (this.stack.length > nodePos) this.stack.length = nodePos
      this.stack[nodePos] = node
    }
    return inner
  }

  runMaybe(str, maxSpeculate) {
    let context = this.context
    let result = this.runMaybeInner(str, maxSpeculate)
    if (result == -1) this.context = context
    return result
  }

  forwardAndUnwind(str, tokenNode) {
    let progress = this.runMaybe(str, 3)
    if (progress < 0) {
      this.stack.push(tokenNode)
      progress = this.runMaybe(str, 0)
    }
    return progress
  }

  push(node) {
    this.stack[this.stack.length] = node
  }

  pushContext(name, value) {
    this.context = new Context(name, value, this.stack.length, this.context)
  }

  popContext() {
    while (this.context && this.stack.length <= this.context.depth)
      this.context = this.context.parent
  }

  copy() {
    return new State(this.stack.slice(), this.context)
  }
}

(typeof exports == "object" ? exports : CodeMirror).GrammarMode = class GrammarMode {
  constructor(config) {
    this.startNode = config.start
    this.tokenNode = config.token
  }

  startState() { return new State([this.startNode], null) }

  copyState(state) { return state.copy() }

  token(stream, state) {
    let str = stream.string.slice(stream.pos)
    stream.pos += state.forwardAndUnwind(str, this.tokenNode)
    let tokenType = tokenValue
    if (stream.eol()) state.forwardAndUnwind("\n", this.tokenNode)
    return tokenType
  }

  blankLine(state) {
    state.forwardAndUnwind("\n", this.tokenNode)
  }
}
