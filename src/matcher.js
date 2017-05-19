class Context {
  constructor(name, tokenType, parent) {
    this.name = name
    this.tokenType = tokenType
    this.parent = parent
  }
}

class Stream {
  constructor(inner, line, rest) {
    this.inner = inner
    this.line = line
    this.rest = rest
  }

  forward(taken) {
    if (taken < this.rest.length) return new Stream(this.inner, this.line, this.rest.slice(taken))
    if (this.rest != "\n") return new Stream(this.inner, this.line, "\n")
    let line = this.line + 1, str = this.inner && this.inner.lookAhead && this.inner.lookAhead(line)
    return str == null ? null : new Stream(this.inner, line, str)
  }
}

const MAX_LOOKAHEAD = 2

function lookahead(stream, edge) {
  let state = new State([edge.lookahead], null)
  let positive = edge.type != "!"
  for (;;) {
    let taken = state.runMaybe(stream, 0)
    if (taken == -1) return !positive
    if (state.stack.length == 0) return positive
    if (stream.line == MAX_LOOKAHEAD && stream.rest.length == taken) return !positive
    stream = stream.forward(taken)
    if (!stream) return !positive
  }
}

let charsTaken = 0
const nullMatch = /(?=.)/.exec(" ")

function matchEdge(node, stream, start) {
  for (let i = start; i < node.length; i++) {
    let edge = node[i]
    if (edge.lookahead && lookahead(stream, edge)) {
      charsTaken = 0
      return i
    }
    let match = edge.match ? edge.match.exec(stream.rest) : nullMatch
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
  //
  // Returns the amount of characters consumed, or -1 if no match was
  // found. The amount will always be positive, unless the graph
  // returned out of its last node, in which case it may return 0.
  runMaybe(stream, maxSkip, forbidDescent) {
    // FIXME profile whether this hack is actually faster than keeping an array
    let context = this.context, nodePos = this.stack.length - 1
    // Machine finished. Can only happen during lookahead, since the main graph is cyclic.
    if (nodePos == -1) return 0
    let node = this.stack[nodePos]
    for (let i = FIRST_EDGE;;) {
      let match = matchEdge(node, stream, i), curSkip = maxSkip
      if (match == -1) {
        if (curSkip == 0) return -1
        curSkip--
        match = node.length - 1
        charsTaken = 0
      }

      this.pop()
      tokenValue = node[match].apply(this)
      if (forbidDescent && this.stack.length > nodePos + 1) return -1
      if (charsTaken > 0) {
        // If the next node has a single out edge that's a lookahead,
        // try it immediately. (This makes it possible to disambiguate
        // ambiguous edges by adding a lookahead after them.)
        let top = this.stack[this.stack.length - 1]
        if (top && top.length - FIRST_EDGE == 1 && top[FIRST_EDGE].lookahead) {
          if (!lookahead(stream.forward(charsTaken), top[FIRST_EDGE])) return -1
          this.pop()
          top[FIRST_EDGE].apply(this)
        }
        return charsTaken
      }

      let inner = this.runMaybe(stream, curSkip, forbidDescent || (curSkip < maxSkip && this.stack.length <= nodePos))
      if (inner > -1) return inner

      // Reset to start state
      this.context = context
      if (this.stack.length > nodePos) this.stack.length = nodePos
      this.stack[nodePos] = node

      // Continue matching after this edge
      if ((i = match + 1) == node.length) return -1
    }
  }

  forward(stream, tokenNode) {
    let progress = this.runMaybe(stream, 3)
    if (progress < 0) {
      this.stack.push(tokenNode)
      progress = this.runMaybe(stream, 0)
    }
    return progress
  }

  push(node) {
    this.stack[this.stack.length] = node
  }

  pushContext(name, tokenType) {
    this.context = new Context(name, tokenType, this.stack.length, this.context)
  }

  pop() {
    this.stack.pop()
    while (this.context && this.stack.length < this.context.depth)
      this.context = this.context.parent
  }
}

// Reused stream instance for regular, non-lookahead matching
const startStream = new Stream(null, 0, "")

;(typeof exports == "object" ? exports : CodeMirror).GrammarMode = class GrammarMode {
  constructor(config) {
    this.startNode = config.start
    this.tokenNode = config.token
  }

  startState() { return new State([this.startNode], null) }

  copyState(state) { return new State(state.stack.slice(), state.context) }

  token(stream, state) {
    startStream.inner = stream
    startStream.rest = stream.string.slice(stream.pos)
    stream.pos += state.forward(startStream, this.tokenNode)
    let tokenType = tokenValue
    for (let cx = state.context; cx; cx = cx.parent)
      if (cx.tokenType) tokenType = cx.tokenType + (tokenType ? " " + tokenType : "")
    if (stream.eol()) {
      startStream.rest = "\n"
      state.forward(startStream, this.tokenNode)
    }
    return tokenType
  }

  blankLine(state) {
    startStream.inner = null
    startStream.rest = "\n"
    state.forward(startStream, this.tokenNode)
  }
}
