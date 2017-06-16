// FIXME profile this, to see how it compares to old-style modes and
// to identify bottlenecks

// FIXME look into 'normalizing' the graph at load time by i.e.
// precomputing data structures for all edges that can occur through a
// call, so that evaluating these can be more direct and efficient
// without blowing up the on-disk representation
//
// (maybe even move the whole grammar compilation to load time?)

const verbose = 0

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
  constructor() {
    this.stream = null
    this.line = 0
    this.string = ""
  }

  start(stream) {
    this.stream = stream
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

let tokenValue = null

class Call {
  constructor(returnTo, context, inner) {
    this.returnTo = returnTo
    this.context = context
    this.inner = inner
  }
}

let stateClass = (graph, options) => class {
  constructor(stack, context) {
    this.stack = stack
    this.context = context
  }

  matchNode(mcx, pos, node, calling, maxSkip) {
    let edges = graph.nodes[node]
    for (let i = 0; i < edges.length; i++) {
      let op = edges[i], matched, to // See compileEdge in compile.js
      if (op === 0) { // Null match
        matched = pos
        to = edges[++i]
      } else if (op === 1 || op === 2) { // 1, callTarget, returnTo
        let target = edges[++i]          // 2, callTarget, returnTo, context
        to = edges[++i]
        let context = op === 2 ? edges[++i] : null
        let inner = this.matchNode(mcx, pos, target, new Call(to, context, calling), 0)
        if (inner < 0) continue
        if (inner > pos) return inner
        matched = pos
      } else if (op === 3) { // 3, tokenType, matchExpr, nextNode
        let token = edges[++i]
        matched = this.matchExpr(edges[++i], mcx, pos)
        to = edges[++i]
        if (matched > pos) tokenValue = token
      } else { // matchExpr, nextNode
        matched = this.matchExpr(op, mcx, pos)
        to = edges[++i]
      }

      if (matched < 0 && maxSkip > 0 && i == edges.length - 1) {
        if (maxSkip && verbose > 0) console["log"]("Dead end at", mcx.string.slice(pos), node, this.stack.join())
        maxSkip--
        matched = pos
      }
      if (matched > pos) {
        if (verbose > 1)
          console["log"]("Token", JSON.stringify(mcx.string.slice(pos, matched)), "from", node, "to", to)
        this.stack.pop()
        while (this.context && this.context.depth > this.stack.length)
          this.context = this.context.parent
        this.applyCalls(calling, mcx)
        if (to !== -1) this.stack.push(to)
        return matched
      } else if (matched === pos) {
        if (to === -1) {
          if (calling) return pos
          this.stack.pop()
          to = this.stack[this.stack.length - 1]
        }
        let inner = this.matchNode(mcx, pos, to, calling, 0)
        if (inner > -1) return inner
      }
    }
    return -1
  }

  applyCalls(call, mcx) {
    if (!call) return
    this.applyCalls(call.inner, mcx)
    if (call.returnTo !== -1) this.stack.push(call.returnTo)
    if (call.context) this.context = new Context(call.context.name, call.context.token, this.stack.length, this.context, mcx.stream)
  }

  runMaybe(mcx, pos, maxSkip) {
    tokenValue = null
    return this.matchNode(mcx, pos, this.stack[this.stack.length - 1], null, maxSkip)
  }

  forward(mcx) {
    let progress = this.runMaybe(mcx, 0, 2)
    if (progress < 0) {
      if (verbose > 0) console["log"]("Lost it at", mcx.string, this.stack.join())
      this.stack.push(graph.token)
      progress = this.runMaybe(mcx, 0, 0)
    }
    return progress
  }

  lookahead(mcx, pos, start) {
    let state = new this.constructor([start], null)
    for (;;) {
      // FIXME implement custom scanning algorithm
      let newPos = state.runMaybe(mcx, pos, 0)
      if (newPos < 0) return false
      if (state.stack.length === 0) return true
      pos = newPos
    }
  }

  matchExpr(expr, mcx, pos) {
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
        pos = this.matchExpr(expr[i], mcx, pos)
        if (pos < 0) return -1
      }
      return pos
    } else if (op === 1) { // OP_CHOICE, ...rest
      for (let i = 1, e = expr.length - 1;; i++) {
        let cur = this.matchExpr(expr[i], mcx, pos)
        if (i === e || cur > -1) return cur
      }
      return -1
    } else if (op === 2 || op === 3) { // OP_STAR/OP_PLUS, expr
      if (op === 3 && (pos = this.matchExpr(expr[1], mcx, pos)) < 0) return -1
      for (;;) {
        let inner = this.matchExpr(expr[1], mcx, pos)
        if (inner == -1) return pos
        pos = inner
      }
    } else if (op === 4) { // OP_MAYBE, expr
      return Math.max(this.matchExpr(expr[1], mcx, pos), pos)
    } else if (op === 5) { // OP_LOOKAHEAD, expr
      return this.lookahead(mcx, pos, expr[1]) ? pos : -1
    } else if (op === 6) { // OP_NEG_LOOKAHEAD, expr
      return this.lookahead(mcx, pos, expr[1]) ? -1 : pos
    } else if (op === 7) { // OP_PREDICATE, name
      return options.predicates[expr[1]](mcx.string, pos, this.context) ? pos : -1
    } else {
      throw new Error("Unknown match type " + expr)
    }
  }

  contextAt(line, linePos) {
    let copy = this.copy(), mcx = new MatchContext, pos = 0, lastCx = this.context
    mcx.string = line + "\n"
    for (;;) {
      let matched = copy.runMaybe(mcx, pos, 0)
      if (matched == -1) return copy.context
      if (matched > linePos) {
        let context = copy.context
        if (pos == linePos) {
          trim: while (context) {
            for (let prev = lastCx; prev; prev = prev.parent) if (prev === context) break trim
            context = context.parent
          }
        }
        return context
      }
      pos = matched
      lastCx = copy.context
    }
  }

  copy() {
    return new this.constructor(this.stack.slice(), this.context)
  }

  static start() {
    return new this([graph.start], null)
  }
}

// declare global: CodeMirror
CodeMirror.GrammarMode = class GrammarMode {
  constructor(graph, options) {
    this.State = stateClass(graph, options || {})
    this.mcx = new MatchContext
  }

  startState() { return this.State.start() }

  copyState(state) { return state.copy() }

  token(stream, state) {
    stream.pos += state.forward(this.mcx.start(stream))
    let tokenType = tokenValue
    for (let cx = state.context; cx; cx = cx.parent)
      if (cx.tokenType) tokenType = cx.tokenType + (tokenType ? " " + tokenType : "")
    if (stream.eol())
      state.forward(this.mcx.start(null))
    return tokenType
  }

  blankLine(state) {
    state.forward(this.mcx.start(null))
  }
}
