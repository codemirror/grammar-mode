// FIXME profile this, to see how it compares to old-style modes and
// to identify bottlenecks

class Context {
  constructor(name, tokenType, depth, parent, stream) {
    this.name = name
    this.tokenType = tokenType
    this.depth = depth
    this.parent = parent
    this.startLine = stream ? stream.string : "\n"
    this.startPos = stream ? stream.start : 0
  }
}

const MAX_LOOKAHEAD_LINES = 2

class MatchContext {
  constructor(graph, options) {
    this.graph = graph
    this.nodes = graph.nodes
    this.options = options
    this.stream = null
    this.state = null
    this.line = 0
    this.string = ""
  }

  start(stream, state) {
    this.stream = stream
    this.state = state
    this.line = 0
    this.string = stream ? stream.string.slice(stream.start) : "\n"
    return this
  }

  ahead(n) {
    for (;;) {
      if (n <= this.string.length) return true
      if (this.string.charCodeAt(this.string.length - 1) !== 10) {
        this.string += "\n"
      } else if (this.line === MAX_LOOKAHEAD_LINES || !this.stream || !this.stream.lookAhead) {
        return false
      } else {
        let next = this.stream.lookAhead(this.line + 1)
        if (next == null) return false
        this.string += next + "\n"
        this.line++
      }
    }
  }
}

function lookahead(mcx, pos, start) {
  let state = new State([start], null)
  for (;;) {
    // FIXME implement custom scanning algorithm?
    let newPos = state.runMaybe(mcx, 0, pos)
    if (newPos < 0) return false
    if (state.stack.length === 0) return true
    pos = newPos
  }
}

function matchExpr(expr, mcx, pos) {
  if (expr === null) return pos

  if (typeof expr === "string") {
    let end = pos + expr.length
    return mcx.ahead(end) && mcx.string.slice(pos, end) === expr ? end : -1
  }
  if (expr.exec) {
    let m = mcx.ahead(pos + 1) && expr.exec(pos > 0 ? mcx.string.slice(pos) : mcx.string)
    if (!m) return -1
    return pos + m[0].length
  }

  let op = expr[0]
  if (op === 0) { // OP_SEQ, ...rest
    for (let i = 1; i < expr.length; i++) {
      pos = matchExpr(expr[i], mcx, pos)
      if (pos < 0) return -1
    }
    return pos
  } else if (op === 1) { // OP_CHOICE, ...rest
    for (let i = 1, e = expr.length - 1;; i++) {
      let cur = matchExpr(expr[i], mcx, pos)
      if (i === e || cur > -1) return cur
    }
    return -1
  } else if (op === 2 || op === 3) { // OP_STAR/OP_PLUS, expr
    if (op === 3 && (pos = matchExpr(expr[1], mcx, pos)) < 0) return -1
    for (;;) {
      let inner = matchExpr(expr[1], mcx, pos)
      if (inner == -1) return pos
      pos = inner
    }
  } else if (op === 4) { // OP_MAYBE, expr
    return Math.max(matchExpr(expr[1], mcx, pos), pos)
  } else if (op === 5) { // OP_LOOKAHEAD, expr
    return lookahead(mcx, pos, expr[1]) ? pos : -1
  } else if (op === 6) { // OP_NEG_LOOKAHEAD, expr
    return lookahead(mcx, pos, expr[1]) ? -1 : pos
  } else if (op === 7) { // OP_PREDICATE, name
    return mcx.options.predicates[expr[1]](mcx.string, pos, mcx.state.context) ? pos : -1
  } else {
    throw new Error("Unknown match type " + expr)
  }
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
  // Returns the amount of characters consumed, or -1 if no match was
  // found. The amount will always be positive, unless the graph
  // returned out of its last node, in which case it may return 0.
  runMaybe(mcx, maxSkip, pos) {
    // FIXME profile whether this hack is actually faster than keeping an array
    let context = this.context, nodePos = this.stack.length - 1
    // Machine finished. Can only happen during lookahead, since the main graph is cyclic.
    if (nodePos === -1) return 0
    let nodeName = this.stack[nodePos], node = mcx.nodes[nodeName]
    for (let i = 0, last = node.length - 2;; i += 2) {
      let newPos = matchExpr(node[i], mcx, pos)
      if (newPos < 0) {
        if (i < last) continue
        if (maxSkip === 0) return -1
        newPos = pos
        maxSkip--
      }

      tokenValue = this.apply(node[i + 1], mcx)
      if (newPos > pos) return newPos

      let inner = this.runMaybe(mcx, i === last ? maxSkip : 0, pos)
      if (inner > -1) return inner

      // Reset to state we started with
      this.context = context
      if (this.stack.length > nodePos) this.stack.length = nodePos
      this.stack[nodePos] = nodeName

      // Continue trying to match further edges in this node, if any
      if (i === last) return -1
    }
  }

  apply(code, mcx) {
    this.pop()
    for (let i = 0; i < code.length;) {
      let op = code[i++]
      if (op === 0) // PUSH node
        this.stack[this.stack.length] = code[i++]
      else if (op === 1) // ADD_CONTEXT name
        this.pushContext(code[i++], null, mcx.stream)
      else if (op === 2) // ADD_TOKEN_CONTEXT name tokenType
        this.pushContext(code[i++], code[i++], mcx.stream)
      else if (op === 3) // TOKEN tokenType
        return code[i++]
      else
        throw new Error("Unknown opcode " + op)
    }
  }

  forward(mcx) {
    let progress = this.runMaybe(mcx, 2, 0)
    if (progress < 0) {
      this.stack.push(mcx.graph.token)
      progress = this.runMaybe(mcx, 0, 0)
    }
    return progress
  }

  pushContext(name, tokenType, stream) {
    this.context = new Context(name, tokenType, this.stack.length, this.context, stream)
  }

  pop() {
    this.stack.pop()
    while (this.context && this.stack.length < this.context.depth)
      this.context = this.context.parent
  }
}

// declare global: CodeMirror
CodeMirror.GrammarMode = class GrammarMode {
  constructor(graph, options) {
    this.graph = graph
    this.options = options || {}
    this.mcx = new MatchContext(graph, options)
  }

  startState() { return new State([this.graph.start], null) }

  copyState(state) { return new State(state.stack.slice(), state.context) }

  token(stream, state) {
    stream.pos += state.forward(this.mcx.start(stream, state))
    let tokenType = tokenValue
    for (let cx = state.context; cx; cx = cx.parent)
      if (cx.tokenType) tokenType = cx.tokenType + (tokenType ? " " + tokenType : "")
    if (stream.eol())
      state.forward(this.mcx.start(null, state))
    return tokenType
  }

  blankLine(state) {
    state.forward(this.mcx.start(null, state))
  }
}
