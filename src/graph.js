const {nullMatch, anyMatch, StringMatch, RangeMatch, SeqMatch, ChoiceMatch, RepeatMatch,
       LookaheadMatch, SimpleLookaheadMatch, eqArray} = require("./matchexpr")

class Graph {
  constructor(grammar) {
    this.nodes = Object.create(null)
    this.curRule = null
    this.rules = Object.create(null)
    let first = null
    for (let name in grammar.rules) {
      if (first == null) first = name
      let ast = grammar.rules[name]
      this.rules[name] = {name,
                          value: ast.value,
                          space: ast.space && ast.space.name,
                          expr: ast.expr,
                          start: null, end: null,
                          uses: 0}
    }
    if (!first) throw new SyntaxError("Empty grammar")
    if (this.rules._TOKEN) throw new SyntaxError("The rule name '_TOKEN' is reserved")
    let tokens = []
    for (let name in this.rules) {
      let rule = this.rules[name]
      if (rule.space) this.useRule(rule.space, 2)
      let ast = grammar.rules[name]
      if (ast.isToken) {
        this.useRule(name, 1)
        tokens.push(name)
      }
      if (ast.value) this.useRule(name, 2)
      forAllExprs(rule.expr, expr => {
        if (expr.type == "RuleIdentifier") this.useRule(expr.id.name, 1)
      })
    }
    if (this.rules.START) {
      this.useRule("START", 1)
      this.getRule("START")
    } else {
      this.useRule(first, 1)
      this.buildStartRule(first)
    }
    this.buildTokenRule(tokens)
  }

  useRule(name, n) {
    let rule = this.rules[name]
    if (!rule) throw new SyntaxError(`No rule '${name}' defined`)
    rule.uses += n
  }

  getRule(name) {
    let rule = this.rules[name]
    if (!rule.start) {
      this.withRule(rule, () => {
        let start = rule.start = this.node()
        let end = rule.end = this.node(null, "end")
        if (rule.value) {
          let push = this.node(null, "push")
          this.edge(start, push, null, [new PushContext(name, rule.value)])
          start = push
          if (rule.uses == 1) end = this.node()
        }
        generateExpr(start, end, rule.expr, this)
        if (rule.value) {
          if (rule.uses > 1)
            this.edge(end, null, null, [popContext, returnEffect])
          else
            this.edge(end, rule.end, null, [popContext])
        } else if (rule.uses > 1) {
          this.edge(rule.end, null, null, [returnEffect])
        }
      })
    }
    return rule
  }

  node(base, suffix) {
    let label = (base || this.curRule.name) + (suffix ? "_" + suffix : "")
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
      if (node == "expr_lookahead_end") console.trace("reached")
      if (node in reached) return
      reached[node] = true
      work.push(node)
    }
    reach(this.rules.START.start)
    reach(this.rules._TOKEN.start)

    while (work.length) {
      let next = this.nodes[work.pop()]
      for (let i = 0; i < next.length; i++) {
        let edge = next[i]
        if (edge.to) reach(edge.to)
        if (edge.match instanceof LookaheadMatch) reach(edge.match.start)
        for (let j = 0; j < edge.effects.length; j++)
          if (edge.effects[j] instanceof CallEffect)
            reach(edge.effects[j].returnTo)
      }
    }

    for (let n in this.nodes) if (!(n in reached)) delete this.nodes[n]
  }

  buildStartRule(first) {
    let rule = this.rules.START = {
      name: "START",
      space: this.rules[first].space,
      start: this.node("START")
    }
    let cur = rule.start, space = rule.space && this.getRule(rule.space)
    if (space) {
      let next = this.node("START")
      this.edge(cur, space.start, null, [new CallEffect(rule.space, next)])
      cur = next
    }
    callRule(cur, rule.start, first, this)
  }

  buildTokenRule(tokens) {
    let rule = this.rules._TOKEN = {
      name: "_TOKEN",
      start: this.node("_TOKEN"),
      end: this.node("_TOKEN", "end"),
      uses: 2
    }
    this.edge(rule.end, null, null, [returnEffect])
    for (let i = 0; i < tokens.length; i++)
      callRule(rule.start, rule.end, tokens[i], this)
    this.edge(rule.start, rule.end, anyMatch)
  }

  merge(a, b) {
    delete this.nodes[b]
    for (let node in this.nodes) {
      let edges = this.nodes[node]
      for (let i = 0; i < edges.length; i++) edges[i].merge(a, b)
    }
    for (let name in this.rules) {
      let rule = this.rules[name]
      if (rule.start == b) rule.start = a
      if (rule.end == b) rule.end = a
    }
  }

  toString() {
    let output = "digraph {\n"
    for (let node in this.nodes) {
      let edges = this.nodes[node]
      for (let i = 0; i < edges.length; i++)
        output += "  " + edges[i].toString(node) + ";\n"
    }
    return output + "}\n"
  }

  countIncoming(node) {
    let count = 0
    for (let n in this.nodes) {
      let edges = this.nodes[n]
      for (let i = 0; i < edges.length; i++) if (edges[i].to == node) count++
    }
    return count
  }
}

class Edge {
  constructor(to, match, effects) {
    this.to = to
    this.match = match
    this.effects = effects || []
  }

  eq(other) {
    return this.to == other.to && this.match.eq(other.match) && eqArray(this.effects, other.effects)
  }

  merge(a, b) {
    if (this.to == b) this.to = a
    for (let i = 0; i < this.effects.length; i++) this.effects[i].merge(a, b)
    if (this.match instanceof LookaheadMatch && this.match.start == b) this.match.start = a
  }

  toString(from) {
    let effects = this.effects.length ? " " + this.effects.join(" ") : ""
    return `${from} -> ${this.to || "NULL"}[label=${JSON.stringify(this.match.regexp() + effects)}]`
  }
}

function forAllExprs(e, f) {
  f(e)
  if (e.exprs) for (let i = 0; i < e.exprs.length; i++) forAllExprs(e.exprs[i], f)
  if (e.expr) {
    forAllExprs(e.expr, f)
    if (e.type == "+") forAllExprs(e.expr, f) // The body of + is duplicated
  }
}

const CallEffect = exports.CallEffect = class {
  constructor(rule, returnTo) {
    this.rule = rule
    this.returnTo = returnTo
  }

  eq(other) {
    return other instanceof CallEffect && other.rule == this.rule && other.returnTo == this.returnTo
  }

  merge(a, b) { if (this.returnTo == b) this.returnTo = a }

  toString() { return `call ${this.rule} -> ${this.returnTo}` }
}

const returnEffect = exports.returnEffect = new class ReturnEffect {
  eq(other) { return other == this }

  merge() {}

  toString() { return "return" }
}

const PushContext = exports.PushContext = class {
  constructor(name, value) {
    this.name = name
    this.value = value
  }
  eq(other) { return other instanceof PushContext && other.name == this.name }
  merge() {}
  toString() { return `push ${this.name}` }
}

const popContext = exports.popContext = new class PopContext {
  eq(other) { return other == this }
  merge() {}
  toString() { return "pop" }
}

function maybeSpaceBefore(node, graph) {
  let withSpace = graph.curRule.space
  if (!withSpace) return node
  let space = graph.getRule(withSpace), before = graph.node()
  graph.edge(before, space.start, null, [new CallEffect(withSpace, node)])
  return before
}

function callRule(start, end, name, graph) {
  let rule = graph.getRule(name)
  if (rule.uses == 1) {
    graph.edge(start, rule.start)
    graph.edge(rule.end, end)
  } else {
    graph.edge(start, rule.start, null, [new CallEffect(name, end)])
  }
}

function generateExpr(start, end, expr, graph) {
  let t = expr.type
  if (t == "CharacterRange") {
    graph.edge(start, end, new RangeMatch(expr.from, expr.to))
  } else if (t == "StringMatch") {
    let separated = expr.value.split(/\n\r?|\r/)
    for (let i = 0; i < separated.length - 1; i++) {
      let line = separated[i]
      if (line) {
        let after = graph.node()
        graph.edge(start, after, new StringMatch(line))
        start = after
      }
      let after = graph.node()
      graph.edge(start, after, new StringMatch("\n"))
      start = after
    }
    let last = separated[separated.length - 1]
    graph.edge(start, end, last ? new StringMatch(last) : nullMatch)
  } else if (t == "AnyMatch") {
    graph.edge(start, end, anyMatch)
  } else if (t == "RuleIdentifier") {
    callRule(start, end, expr.id.name, graph)
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      graph.edge(start, end)
      generateExpr(end, maybeSpaceBefore(end, graph), expr.expr, graph)
    } else if (expr.kind == "+") {
      generateExpr(start, maybeSpaceBefore(end, graph), expr.expr, graph)
      generateExpr(end, maybeSpaceBefore(end, graph), expr.expr, graph)
    } else if (expr.kind == "?") {
      generateExpr(start, end, expr.expr, graph)
      graph.edge(start, end)
    }
  } else if (t == "LookaheadMatch") {
    let before = graph.node(null, "lookahead"), after = graph.node(null, "lookahead_end")
    generateExpr(before, after, expr.expr, graph)
    graph.edge(after, null, null, [returnEffect])
    graph.edge(start, end, new LookaheadMatch(before, t.kind == "~"))
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = end, to = next, cur = expr.exprs[i]
      if (i < expr.exprs.length - 1) {
        next = graph.node()
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
  outer: for (let i = 0; i < edges.length; i++) {
    let first = edges[i]
    if (first.to == node || first.to == graph.rules.START.start || !first.to) continue
    let next = graph.nodes[first.to]
    if (next.length == 0) continue
    if (next.length == 0 ||
        next.length > 1 && graph.countIncoming(first.to) > 1 && edges.length == 1) continue
    let newEdges = []
    for (let j = 0; j < next.length; j++) {
      let second = next[j], end = second.to, effects
      if (end == first.to ||
          (!first.match.isNull && (second.match.isolated || second.effects.some(e => e instanceof PushContext))) ||
          (!second.match.isNull && (first.match.isolated || first.effects.indexOf(popContext) > -1)))
        continue outer
      // If second is a return edge
      if (!end) for (let k = first.effects.length - 1; k >= 0; k--) {
        if (first.effects[k] instanceof CallEffect) {
          // Matching call found, wire directly to return address, remove call/return effects
          end = first.effects[k].returnTo
          effects = first.effects.slice(0, k).concat(first.effects.slice(k + 1))
            .concat(second.effects.filter(e => e != returnEffect))
        }
      }
      if (!effects) effects = first.effects.concat(second.effects)
      newEdges.push(new Edge(end, SeqMatch.create(first.match, second.match), effects))
    }
    edges.splice(i, 1, ...newEdges)
    i += newEdges.length - 1
    return true
    if (result) return true
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
    if (edge.match.isNull || edge.match.isolated) continue
    for (let j = i + 1; j < edges.length; j++) {
      let other = edges[j]
      if (other.to == edge.to && sameEffect(edge, other) && !other.match.isNull && !other.match.isolated)
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
  if (node == graph.rules.START.start) return
  let cycleIndex, cycleEdge
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i]
    if (edge.to == node && !edge.match.isolated && !edge.isNull) {
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

function simplifyLookahead(graph, _node, edges) {
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i]
    if (!(edge.match instanceof LookaheadMatch)) continue
    let out = graph.nodes[edge.match.start]
    if (out.length != 1 || out[0].to || out[0].match.isolated) continue
    edges[i] = new Edge(edge.to, new SimpleLookaheadMatch(out[0].match, edge.match.positive), edge.effects)
    return true
  }
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
  while (simplifyWith(graph, [simplifyChoice, simplifyRepeat, simplifySequence, simplifyLookahead])) {}
}

function mergeDuplicates(graph) {
  outer: for (;;) {
    let names = Object.keys(graph.nodes)
    for (let i = 0; i < names.length; i++) {
      let name = names[i], edges = graph.nodes[name]
      for (let j = i + 1; j < names.length; j++) {
        let otherName = names[j]
        if (eqArray(edges, graph.nodes[otherName])) {
          if (otherName == "_TOKEN") { let tmp = name; name = otherName; otherName = tmp }
          graph.merge(name, otherName)
          continue outer
        }
      }
    }
    break
  }
}

exports.buildGraph = function(grammar) {
  let graph = new Graph(grammar)
  simplify(graph)
  mergeDuplicates(graph)
  graph.gc()
  return graph
}
