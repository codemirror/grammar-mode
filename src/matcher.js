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

class Stream {
  constructor() {
    this.stream = null
    this.graph = null
    this.line = 0
    this.string = ""
  }

  init(stream, graph) {
    this.stream = stream
    this.graph = graph
    this.line = 0
    this.string = stream ? stream.string.slice(stream.start) : "\n"
    return this
  }

  ahead(n) {
    for (;;) {
      if (n <= this.string.length) return true
      if (this.string.charAt(this.string.length - 1) !== 10) {
        this.string += "\n"
      } else if (this.line === MAX_LOOKAHEAD_LINES || !this.stream || !this.stream.lookAhead) {
        return false
      } else {
        let next = this.stream.lookAhead(this.line + 1)
        if (next == null) return false
        this.string += next
        this.line++
      }
    }
  }
}

function lookahead(stream, pos, start) {
  let state = new State([start], null)
  for (;;) {
    // FIXME implement custom scanning algorithm?
    let taken = state.runMaybe(stream, 0, pos)
    if (taken === -1) return false
    if (state.stack.length === 0) return true
    pos += taken
  }
}

function matchExpr(expr, stream, pos) {
  if (expr === null) return pos

  if (typeof expr === "string") {
    let end = pos + expr.length
    return stream.ahead(end) && stream.string.slice(pos, end) === expr ? end : -1
  }
  if (expr.exec) {
    let m = expr.exec(stream.string.slice(pos))
    if (!m) return -1
    return pos + m[0].length
  }

  let op = expr[0]
  if (op === 0) { // OP_SEQ, ...rest
    for (let i = 1; i < expr.length; i++) {
      pos = matchExpr(expr[i], stream, pos)
      if (pos < 0) return -1
    }
    return pos
  } else if (op === 1) { // OP_CHOICE, ...rest
    for (let i = 1, e = expr.length - 1;; i++) {
      let cur = matchExpr(expr[i], stream, pos)
      if (i === e || cur > -1) return cur
    }
    return -1
  } else if (op === 2 || op === 3) { // OP_STAR/OP_PLUS, expr
    if (op === 3 && (pos = matchExpr(expr[1], stream, pos)) < 0) return -1
    for (;;) {
      let inner = matchExpr(expr[1], stream, pos)
      if (inner == -1) return pos
      pos = inner
    }
  } else if (op === 4) { // OP_MAYBE, expr
    return Math.max(matchExpr(expr[1], stream, pos), pos)
  } else if (op === 5) { // OP_LOOKAHEAD, expr
    return lookahead(stream, pos, expr[1]) ? pos : -1
  } else if (op === 6) { // OP_NEG_LOOKAHEAD, expr
    return lookahead(stream, pos, expr[1]) ? -1 : pos
  } else {
    throw new Error("Unknown match type " + expr)
  }
}

let charsTaken = 0

function matchEdge(node, stream, start) {
  for (let i = start; i < node.length; i += 2) {
    charsTaken = matchExpr(node[i], stream, 0)
    if (charsTaken > -1) return i
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
  // Returns the amount of characters consumed, or -1 if no match was
  // found. The amount will always be positive, unless the graph
  // returned out of its last node, in which case it may return 0.
  runMaybe(stream, maxSkip) {
    // FIXME profile whether this hack is actually faster than keeping an array
    let context = this.context, nodePos = this.stack.length - 1
    // Machine finished. Can only happen during lookahead, since the main graph is cyclic.
    if (nodePos === -1) return 0
    let nodeName = this.stack[nodePos], node = stream.graph.nodes[nodeName]
    for (let i = 0, last = node.length - 2;;) {
      let match = matchEdge(node, stream, i)
      let taken = charsTaken, curSkip = match == last ? maxSkip : 0
      if (match === -1) {
        if (maxSkip === 0) return -1
        curSkip = maxSkip - 1
        match = last
        taken = 0
      }

      tokenValue = this.apply(node[match + 1], stream)
      if (taken > 0) return taken

      let inner = this.runMaybe(stream, curSkip)
      if (inner > -1) return inner

      // Reset to state we started with
      this.context = context
      if (this.stack.length > nodePos) this.stack.length = nodePos
      this.stack[nodePos] = nodeName

      // Continue trying to match further edges in this node, if any
      if ((i = match + 2) > last) return -1
    }
  }

  apply(code, stream) {
    this.pop()
    for (let i = 0; i < code.length;) {
      let op = code[i++]
      if (op === 0) // PUSH node
        this.stack[this.stack.length] = code[i++]
      else if (op === 1) // ADD_CONTEXT name
        this.pushContext(code[i++], null, stream.stream)
      else if (op === 2) // ADD_TOKEN_CONTEXT name tokenType
        this.pushContext(code[i++], code[i++], stream.stream)
      else if (op === 3) // TOKEN tokenType
        return code[i++]
      else
        throw new Error("Unknown opcode " + op)
    }
  }

  forward(stream) {
    let progress = this.runMaybe(stream, 2)
    if (progress < 0) {
      this.stack.push(stream.graph.token)
      progress = this.runMaybe(stream, 0)
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

// Reused stream instance for regular, non-lookahead matching
const streamObj = new Stream

;(typeof exports === "object" ? exports : CodeMirror).GrammarMode = class GrammarMode {
  constructor(graph) {
    this.graph = graph
  }

  startState() { return new State([this.graph.start], null) }

  copyState(state) { return new State(state.stack.slice(), state.context) }

  token(stream, state) {
    stream.pos += state.forward(streamObj.init(stream, this.graph))
    let tokenType = tokenValue
    for (let cx = state.context; cx; cx = cx.parent)
      if (cx.tokenType) tokenType = cx.tokenType + (tokenType ? " " + tokenType : "")
    if (stream.eol())
      state.forward(streamObj.init(null, this.graph))
    return tokenType
  }

  blankLine(state) {
    state.forward(streamObj.init(null, this.graph))
  }
}
