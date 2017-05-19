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

function matchEdge(node, str, start) {
  for (let i = start; i < node.length; i++) {
    let edge = node[i]
    if (edge.lookahead) throw new Error("FIXME")
    let match = edge.match ? edge.match.exec(str) : nullMatch
    if (match) {
      charsTaken = match[0].length
      return i
    }
  }
  return -1
}

let tokenValue = null

const FIRST_EDGE = 1

class State {
  constructor(stack, context) {
    this.stack = stack
    this.context = context
  }

  // Try to match the given string against the current state until
  // progress is made (characters from the string are consumed). When
  // maxSkip > 0, the function is allowed to skip forward through the
  // node's last out-edge and attempt to match from the next node.
  //
  // Uses recursion to make it possible to restore the state to its
  // initial form when a match fails (at each level, to allow
  // backtracking). This relies on the fact that an edge can pop at
  // most one element off the stack, so for each edge followed we need
  // to keep only the old stack depth and the thing popped off to be
  // able to 'repair' it.
  //
  // Once a skipped edge has shortened the stack, `forbidDescent`
  // prevents further edges from growing the stack again, to avoid
  // entering random irrelevant rules through this mechanism.
  runMaybe(str, maxSkip, forbidDescent) {
    // FIXME profile whether this hack is actually faster than keeping an array
    let context = this.context, nodePos = this.stack.length - 1, node = this.stack[nodePos]
    for (let i = FIRST_EDGE;;) {
      let match = matchEdge(node, str, i), curSkip = maxSkip
      if (match == -1) {
        if (curSkip == 0) return -1
        curSkip--
        match = node.length - 1
        charsTaken = 0
      }
      this.stack.pop()
      this.popContext()
      tokenValue = node[match].apply(this)
      if (forbidDescent && this.stack.length > nodePos + 1) return -1
      if (charsTaken > 0) {
        // FIXME try lone lookahead edges before returning
        return charsTaken
      }
      let inner = this.runMaybe(str, curSkip, forbidDescent || (curSkip < maxSkip && this.stack.length <= nodePos))
      if (inner > -1) return inner

      // Reset to start state
      this.context = context
      if (this.stack.length > nodePos) this.stack.length = nodePos
      this.stack[nodePos] = node

      // Continue matching after this edge
      if ((i = match + 1) == node.length) return -1
    }
  }

  forward(str, tokenNode) {
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
    stream.pos += state.forward(str, this.tokenNode)
    let tokenType = tokenValue
    if (stream.eol()) state.forward("\n", this.tokenNode)
    return tokenType
  }

  blankLine(state) {
    state.forward("\n", this.tokenNode)
  }
}
