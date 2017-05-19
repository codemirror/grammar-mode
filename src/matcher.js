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
    if (this.rest !== "\n") return new Stream(this.inner, this.line, "\n")
    let line = this.line + 1, str = this.inner && this.inner.lookAhead && this.inner.lookAhead(line)
    return str === null ? null : new Stream(this.inner, line, str)
  }
}

const MAX_LOOKAHEAD = 2

function lookahead(stream, graph, value) {
  let positive = value > 0
  let state = new State([graph.nodes[positive ? value : -value]], null)
  for (;;) {
    let taken = state.runMaybe(stream, graph, 0)
    if (taken === -1) return !positive
    if (state.stack.length === 0) return positive
    if (stream.line === MAX_LOOKAHEAD && stream.rest.length === taken) return !positive
    stream = stream.forward(taken)
    if (!stream) return !positive
  }
}

let charsTaken = 0
const nullMatch = /(?=.)/.exec(" ")

function matchEdge(node, stream, graph, start) {
  for (let i = start; i < node.length; i += 2) {
    let match = node[i]
    if (typeof match === "number") { // Numbers encode lookahead
      if (lookahead(stream, graph, match)) {
        charsTaken = 0
        return i
      }
    } else { // Regexp or null
      let result = match ? match.exec(stream.rest) : nullMatch
      if (result) {
        charsTaken = result[0].length
        return i
      }
    }
  }
  return -1
}

let tokenValue = null

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
  runMaybe(stream, graph, maxSkip, forbidDescent) {
    // FIXME profile whether this hack is actually faster than keeping an array
    let context = this.context, nodePos = this.stack.length - 1
    // Machine finished. Can only happen during lookahead, since the main graph is cyclic.
    if (nodePos === -1) return 0
    let node = this.stack[nodePos]
    for (let i = 0;;) {
      let match = matchEdge(node, stream, graph, i), curSkip = maxSkip
      if (match === -1) {
        if (curSkip === 0) return -1
        curSkip--
        match = node.length - 2
        charsTaken = 0
      }

      this.pop()
      tokenValue = this.apply(node[match + 1], graph)
      if (forbidDescent && this.stack.length > nodePos + 1) return -1
      if (charsTaken > 0) {
        // If the next node has a single out edge that's a lookahead,
        // try it immediately. (This makes it possible to disambiguate
        // ambiguous edges by adding a lookahead after them.)
        let top = this.stack[this.stack.length - 1]
        if (top && top.length === 2 && typeof top[0] === "number") {
          if (!lookahead(stream.forward(charsTaken), graph, top[0])) return -1
          this.pop()
          this.apply(top[1], graph)
        }
        return charsTaken
      }

      let inner = this.runMaybe(stream, graph, curSkip,
                                forbidDescent || (curSkip < maxSkip && this.stack.length <= nodePos))
      if (inner > -1) return inner

      // Reset to state we started with
      this.context = context
      if (this.stack.length > nodePos) this.stack.length = nodePos
      this.stack[nodePos] = node

      // Continue trying to match further edges in this node, if any
      if ((i = match + 2) === node.length) return -1
    }
  }

  apply(code, graph) {
    for (let i = 0; i < code.length;) {
      let op = code[i++]
      if (op === 0) // PUSH node
        this.stack.push(graph.nodes[code[i++]])
      else if (op === 1) // ADD_CONTEXT name
        this.pushContext(code[i++])
      else if (op === 2) // ADD_TOKEN_CONTEXT name tokenType
        this.pushContext(code[i++], code[i++])
      else if (op === 3) // TOKEN tokenType
        return code[i++]
    }
  }

  forward(stream, graph) {
    let progress = this.runMaybe(stream, graph, 3)
    if (progress < 0) {
      this.stack.push(graph.nodes[graph.token])
      progress = this.runMaybe(stream, graph, 0)
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

;(typeof exports === "object" ? exports : CodeMirror).GrammarMode = class GrammarMode {
  constructor(graph) {
    this.graph = graph
  }

  startState() { return new State([this.graph.nodes[this.graph.start]], null) }

  copyState(state) { return new State(state.stack.slice(), state.context) }

  token(stream, state) {
    startStream.inner = stream
    startStream.rest = stream.string.slice(stream.pos)
    stream.pos += state.forward(startStream, this.graph)
    let tokenType = tokenValue
    for (let cx = state.context; cx; cx = cx.parent)
      if (cx.tokenType) tokenType = cx.tokenType + (tokenType ? " " + tokenType : "")
    if (stream.eol()) {
      startStream.rest = "\n"
      state.forward(startStream, this.graph)
    }
    return tokenType
  }

  blankLine(state) {
    startStream.inner = null
    startStream.rest = "\n"
    state.forward(startStream, this.graph)
  }
}
