module.exports = function(ast, file) {
  let result = file
  for (let i = ast.body.length - 1; i >= 0; i--) {
    let node = ast.body[i]
    if (node.type == "GrammarDeclaration")
      result = result.slice(0, node.start) + compileGrammar(node, file) + result.slice(node.end)
  }
  return result
}

class Graph {
  constructor(grammar) {
    this.nodes = Object.create(null)
    this.curRule = null
    this.rules = Object.create(null)
    this.first = null
    for (let name in grammar.rules) {
      if (this.first == null) this.first = name
      this.rules[name] = {ast: grammar.rules[name], start: null, end: null, uses: 0}
    }
    if (!this.first) throw new SyntaxError("Empty grammar")
    for (let name in this.rules) {
      let ast = this.rules[name].ast
      if (ast.space) this.useRule(ast.space.name, 2)
      forAllExprs(ast.expr, expr => {
        if (expr.type == "RuleIdentifier") this.useRule(expr.id.name, 1)
      })
    }
    this.getRule(this.first)
  }

  useRule(name, n) {
    let rule = this.rules[name]
    if (!rule) throw new SyntaxError(`No rule '${name}' defined`)
    rule.uses += n
  }

  getRule(name) {
    let rule = this.rules[name]
    if (!rule.start) {
      this.withRule(rule.ast, () => {
        rule.start = this.node()
        let end = rule.end = this.node(null, "end")
        if (rule.ast.value) {
          if (rule.uses > 1) {
            this.edge(end, null, null, [popContext, returnEffect])
          } else {
            rule.end = this.node(null, "pop")
            this.edge(end, rule.end, null, [popContext])
          }
        } else if (rule.uses > 1) {
          this.edge(rule.end, null, null, [returnEffect])
        }
        generateExpr(rule.start, end, rule.ast.expr, this)
        if (rule.ast.value) {
          let push = new PushContext(name, rule.ast.value)
          this.nodes[rule.start].forEach(edge => edge.effects.unshift(push))
        }
      })
    }
    return rule
  }

  node(base, suffix) {
    let label = (base || this.curRule.id.name) + (suffix ? "_" + suffix : "")
    for (let i = 0;; i++) {
      let cur = i ? label + "_" + i : label
      if (!(cur in this.nodes)) {
        this.nodes[cur] = []
        return cur
      }
    }
  }

  edge(from, to, match, effects) {
    let edge = new Edge(to, match || nullMatch, effects)
    this.nodes[from].push(edge)
    return edge
  }

  withRule(rule, f) {
    let prevRule = this.curRule
    this.curRule = rule
    f()
    this.curRule = prevRule
  }

  gc() {
    let reached = Object.create(null), work = []

    function reach(node) {
      if (node in reached) return
      reached[node] = true
      work.push(node)
    }
    reach(this.rules[this.first].start)

    while (work.length) {
      let next = this.nodes[work.pop()]
      for (let i = 0; i < next.length; i++) {
        let edge = next[i]
        if (edge.to) reach(edge.to)
        for (let j = 0; j < edge.effects.length; j++)
          if (edge.effects[j] instanceof CallEffect)
            reach(edge.effects[j].returnTo)
      }
    }

    for (let n in this.nodes) if (!(n in reached)) delete this.nodes[n]
  }
}

class Edge {
  constructor(to, match, effects) {
    this.to = to
    this.match = match
    this.effects = effects || []
  }

  toString(from) {
    let effects = this.effects.length ? " " + this.effects.join(" ") : ""
    return `${from} -> ${this.to || "NULL"}[label=${JSON.stringify(this.match.toString() + effects)}]`
  }
}

class StringMatch {
  constructor(string) {
    this.string = string
  }

  toString() { return JSON.stringify(this.string) }

  get isNull() { return false }
}

class RangeMatch {
  constructor(from, to) {
    this.from = from
    this.to = to
  }

  toString() { return JSON.stringify(this.from) + "-" + JSON.stringify(this.to) }

  get isNull() { return false }
}

const anyMatch = new class AnyMatch {
  toString() { return "_" }
  get isNull() { return false }
}

const nullMatch = new class NullMatch {
  toString() { return "ø" }
  get isNull() { return true }
}

class SeqMatch {
  constructor(matches) {
    this.matches = matches
  }

  toString() { return this.matches.join(" ") }

  get isNull() { return this.matches.every(m => m.isNull) }

  static create(left, right) {
    if (left == nullMatch) return right
    if (right == nullMatch) return left
    let matches = []
    if (left instanceof SeqMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    let last = matches[matches.length - 1]
    if (right instanceof StringMatch && last instanceof StringMatch)
      matches[matches.length - 1] = new StringMatch(last.value + right.value)
    else if (right instanceof SeqMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    if (matches.length == 1) return matches[0]
    else return new SeqMatch(matches)
  }
}

class ChoiceMatch {
  constructor(matches) {
    this.matches = matches
  }

  toString() { return "(" + this.matches.join(" | ") + ")" }

  get isNull() { return false }

  static create(left, right) {
    let matches = []
    if (left instanceof ChoiceMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    if (right instanceof ChoiceMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    return new ChoiceMatch(matches)
  }
}

class RepeatMatch {
  constructor(match) {
    this.match = match
  }

  toString() { return this.match.toString() + "*" }
}

function forAllExprs(e, f) {
  f(e)
  if (e.exprs) for (let i = 0; i < e.exprs.length; i++) forAllExprs(e.exprs[i], f)
  if (e.expr) forAllExprs(e.expr, f)
}

class CallEffect {
  constructor(rule, returnTo) {
    this.rule = rule
    this.returnTo = returnTo
  }

  eq(other) {
    return other instanceof CallEffect && other.rule == this.rule && other.returnTo == this.returnTo
  }

  toString() { return `call ${this.rule} -> ${this.returnTo}` }
}

const returnEffect = new class ReturnEffect {
  eq(other) { return other == this }

  toString() { return "return" }
}

class PushContext {
  constructor(name, value) {
    this.name = name
    this.value = value
  }
  eq(other) { return other instanceof PushContext && other.name == this.name }
  toString() { return `push ${this.name}` }
}

const popContext = new class PopContext {
  eq(other) { return other == this }
  toString() { return "pop" }
}

function maybeSpaceBefore(node, graph) {
  let withSpace = graph.curRule.space
  if (!withSpace) return node
  let space = graph.getRule(withSpace.name), before = graph.node()
  graph.edge(before, space.start, null, [new CallEffect(withSpace.name, node)])
  return before
}

function generateExpr(start, end, expr, graph) {
  let t = expr.type
  if (t == "CharacterRange") {
    graph.edge(start, end, new RangeMatch(expr.from, expr.to))
  } else if (t == "StringMatch") {
    graph.edge(start, end, new StringMatch(expr.value))
  } else if (t == "AnyMatch") {
    graph.edge(start, end, anyMatch)
  } else if (t == "RuleIdentifier") {
    let rule = graph.getRule(expr.id.name)
    if (rule.uses == 1) {
      graph.edge(start, rule.start)
      graph.edge(rule.end, end)
    } else {
      graph.edge(start, rule.start, null, [new CallEffect(expr.id.name, end)])
    }
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      graph.edge(start, end)
      generateExpr(end, maybeSpaceBefore(end, graph), expr.expr, graph)
    } else if (expr.kind == "+") {
      generateExpr(start, end, expr.expr, graph)
      generateExpr(end, maybeSpaceBefore(end, graph), expr.expr, graph)
    } else if (expr.kind == "?") {
      graph.edge(start, end)
      generateExpr(start, maybeSpaceBefore(end, graph), expr.expr, graph)
    }
  } else if (t == "LookaheadMatch") {
    throw new Error("not supporting lookahead yet")
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = end, to = next, cur = expr.exprs[i]
      if (i < expr.exprs.length - 1) {
        next = graph.node()
        // FIXME inserting space too eagerly, probably should be a parameter to generateExpr
        to = maybeSpaceBefore(next, graph)
      }
      generateExpr(start, to, cur, graph)
      start = next
    }
  } else if (t == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      generateExpr(start, end, expr.exprs[i], graph)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function simplifySequence(graph, node, edges) {
  for (let i = 0; i < edges.length; i++) {
    let first = edges[i], next
    if (first.to == node || !first.to || (next = graph.nodes[first.to]).length != 1) continue
    let second = next[0], end = second.to, effects
    if (end == first.to ||
        (!first.match.isNull && second.effects.some(e => e instanceof PushContext)) ||
        (!second.match.isNull && first.effects.indexOf(popContext) > -1))
      continue
    // If second is a return edge
    if (!end) for (let j = first.effects.length - 1; j >= 0; j--) {
      if (first.effects[j] instanceof CallEffect) {
      // Matching call found, wire directly to return address, remove call/return effects
        end = first.effects[j].returnTo
        effects = first.effects.slice(0, j).concat(first.effects.slice(j + 1))
          .concat(second.effects.filter(e => e != returnEffect))
      }
    }
    if (!effects) effects = first.effects.concat(second.effects)
    edges[i] = new Edge(end, SeqMatch.create(first.match, second.match), effects)
    return true
  }
  return false
}

function sameEffect(edge1, edge2) {
  let e1 = edge1.effects, e2 = edge2.effects
  if (e1.length != e2.length) return false
  for (let i = 0; i < e1.length; i++)
    if (!e1[i].eq(e2[i])) return false
  return true
}

function simplifyChoice(graph, node, edges) {
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i], set
    if (edge.match.isNull) continue
    for (let j = i + 1; j < edges.length; j++) {
      let other = edges[j]
      if (other.to == edge.to && sameEffect(edge, other) && !other.match.isNull)
        (set || (set = [edge])).push(other)
    }
    if (set) {
      let match = set[0].match
      for (let j = 1; j < set.length; j++)
        match = ChoiceMatch.create(match, set[j].match)
      graph.nodes[node] = edges.filter(e => set.indexOf(e) == -1).concat(new Edge(edge.to, match, edge.effects))
      return true
    }
  }
  return false
}

function simplifyRepeat(graph, node, edges) {
  let cycleIndex, cycleEdge
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i]
    if (edge.to == node) {
      if (cycleEdge) return false
      cycleIndex = i
      cycleEdge = edge
    }
  }
  if (!cycleEdge || cycleEdge.effects.length) return false
  let newNode = graph.node(node, "split")
  graph.nodes[newNode] = edges.slice(0, cycleIndex).concat(edges.slice(cycleIndex + 1))
  graph.nodes[node] = [new Edge(newNode, new RepeatMatch(cycleEdge.match), cycleEdge.effects)]
  return true
}

// Look for simplification possibilities around the given node, return
// true if anything was done
function simplifyWith(graph, simplifiers) {
  let changed = false
  for (let node in graph.nodes) {
    let edges = graph.nodes[node]
    for (let i = 0; i < simplifiers.length; i++) if (simplifiers[i](graph, node, edges)) {
      changed = true
      break
    }
  }
  return changed
}

function simplify(graph) {
  while (simplifyWith(graph, [simplifyChoice, simplifyRepeat, simplifySequence])) {}
}

function printGraph(graph) {
  let output = "digraph {\n"
  for (let node in graph.nodes) {
    let edges = graph.nodes[node]
    for (let i = 0; i < edges.length; i++)
      output += "  " + edges[i].toString(node) + ";\n"
  }
  return output + "}\n"
}

function compileGrammar(grammar, file) {
  let graph = new Graph(grammar)
  simplify(graph)
  graph.gc()
  console.log(printGraph(graph))
  return "FIXME"
}
