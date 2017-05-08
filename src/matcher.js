class State {
  constructor(stack, context, tokenContext) {
    this.stack = stack
    this.context = this.tokenContext = context
  }

  forward(stream) {
    node: for (;;) {
      let cur = this.stack.pop()
      this.tokenContext = this.context
      for (let i = 0; i < cur.length; i += 2) {
        let match = cur[i]
        if (match && (stream ? stream.match(match) : match.multiline)) {
          cur[i + 1](this)
          if (stream && stream.start == stream.pos)
            continue node
          else
            return this.tokenContext
        } else if (!match || match.test("")) {
          cur[i + 1](this)
          continue node
        }
      }
      console.log("no match for", cur, "against", stream && stream.string.slice(stream.pos))
      throw new Error("No match")
    }
  }

  token(stream) {
    let startNode = this.stack[this.stack.length - 1]
    let context = this.forward(stream)
    if (stream.eol()) { console.log("end line from", this.stack[this.stack.length - 1]) ; this.forward(null) }
    for (; context; context = context.prev)
      if (typeof context.value == "string") return context.value
  }

  pushContext(name, value) {
    this.context = {name, value, prev: this.context}
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
