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

  forward(str) {
    for (;;) {
      let edge = matchEdge(this.stack[this.stack.length - 1], str)
      if (!edge) return false
      this.stack.pop()
      this.popContext()
      edge.apply(this)
      if (charsTaken > 0) return charsTaken
    }
    return -1
  }

  forwardAndUnwind(str, tokenNode) {
    for (let depth = this.stack.length - 1;;) {
      let edge = matchEdge(this.stack[depth], str)
      matched: if (edge) {
        let taken = charsTaken
        if (depth == this.stack.length - 1) {
          // Regular continuation of the current state
          this.stack.pop()
        } else if (taken > 0) {
          // Unwinding some of the stack to continue after a mismatch.
          // Can use this state object because we already know there's
          // progress and we'll commit to this unwinding
          this.stack.length = depth
        } else {
          // Speculatively forward with a copy of the state when
          // encountering a null match during unwinding, since we only
          // want to commit to it when it matches something
          let copy = new State(this.stack.slice(0, depth + 1), this.context)
          let forwarded = copy.forward(str)
          if (forwarded > 0) {
            this.stack = copy.stack
            this.context = copy.context
            return forwarded
          } else {
            break matched
          }
        }
        this.popContext()
        tokenValue = edge.apply(this)
        if (taken > 0) return taken
        depth = this.stack.length - 1
        continue
      }
      // No matching edge, unwind if possible, match a generic token and try again otherwise
      if (depth) depth--
      else depth = this.stack.push(tokenNode) - 1
    }
  }

  token(stream, tokenNode) {
    let str = stream.string.slice(stream.pos)
    tokenValue = null
    stream.pos += this.forwardAndUnwind(str, tokenNode)
    let tokenType = tokenValue
    if (stream.eol()) this.forwardAndUnwind("\n")
    return tokenType
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

exports.GrammarMode = class GrammarMode {
  constructor(startNode, tokenNode) {
    this.startNode = startNode
    this.tokenNode = tokenNode
  }

  startState() { return new State([this.startNode], null) }

  copyState(state) { return state.copy() }

  token(stream, state) {
    return state.token(stream, this.tokenNode)
  }

  blankLine(state) {
    return state.forward(null)
  }
}
