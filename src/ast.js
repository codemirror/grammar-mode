function build(type, from, props) {
  props.type = type
  props.start = from.start
  props.end = from.end
  return props
}

function noSkipAfter(node) {
  let t = node.type
  return t == "LookaheadMatch" || t == "PredicateMatch" || t == "Label" ||
    t == "RepeatedMatch" && node.kind != "?"
}

// Replaces super matches, inserts skip matches in the appropriate
// places, splits string matches with newlines, and collapses nested
// sequence/choice expressions, so that further passes don't have to
// worry about those.
let normalizeExpr = exports.normalizeExpr = function(expr, ruleName, superGrammar, skip) {
  if (expr.type == "StringMatch" && expr.value > 1 && expr.value.indexOf("\n") > -1) {
    let exprs = []
    expr.value.split(/(?=\n)/).forEach(part => {
      exprs.push(build("StringMatch", expr, {value: "\n"}))
      if (part.length > 1) exprs.push(build("StringMatch", expr, {value: part.slice(1)}))
    })
    return build("SequenceMatch", expr, {exprs})
  } else if (expr.type == "RuleIdentifier") {
    for (let i = 0; i < expr.arguments.length; i++)
      expr.arguments[i] = normalizeExpr(expr.arguments[i], ruleName, superGrammar, skip)
  } else if (expr.type == "RepeatedMatch") {
    let inner = normalizeExpr(expr.expr, ruleName, superGrammar, skip)
    if (skip && expr.kind != "?") inner = build("SequenceMatch", inner, {exprs: [inner, skip]})
    expr.expr = inner
  } else if (expr.type == "LookaheadMatch") {
    expr.expr = normalizeExpr(expr.expr, ruleName, null, skip)
  } else if (expr.type == "SequenceMatch") {
    let exprs = []
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = normalizeExpr(expr.exprs[i], ruleName, superGrammar, skip)
      if (next.type == "SequenceMatch") exprs = exprs.concat(next.exprs)
      else exprs.push(next)
      if (skip && i < expr.exprs.length - 1 && !noSkipAfter(next))
        exprs.push(skip)
    }
    expr.exprs = exprs
  } else if (expr.type == "ChoiceMatch") {
    let exprs = []
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = normalizeExpr(expr.exprs[i], ruleName, superGrammar, skip)
      if (next.type == "ChoiceMatch") exprs = exprs.concat(next.exprs)
      else exprs.push(next)
    }
    expr.exprs = exprs
  } else if (expr.type == "SuperMatch") {
    for (let grammar = superGrammar; grammar; grammar = grammar.super) {
      let rule = grammar.rules[ruleName]
      if (rule) return normalizeExpr(rule.expr, ruleName, grammar.super, skip)
    }
    throw new SyntaxError(`No super rule found for '${ruleName}'`)
  }
  return expr
}

let eqExpr = exports.eqExpr = function(a, b) {
  if (a.type != b.type) return false
  if (a.type == "StringMatch") return a.value == b.value
  if (a.type == "CharacterRange") return a.from == b.from && a.to == b.to
  if (a.type == "AnyMatch" || a.type == "DotMatch") return true
  if (a.type == "RuleIdentifier") return a.id.name == b.id.name && eqExprs(a.arguments, b.arguments)
  if (a.type == "RepeatedMatch" || a.type == "LookaheadMatch") return a.kind == b.kind && eqExpr(a.expr, b.expr)
  if (a.type == "SequenceMatch" || a.type == "ChoiceMatch") return eqExprs(a.exprs, b.exprs)
  if (a.type == "PredicateMatch") return a.id.name == b.id.name
  throw new Error("Missed case in eqExpr: " + a.type)
}

let eqExprs = exports.eqExprs = function(a, b) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!eqExpr(a[i], b[i])) return false
  return true
}

function instantiateArray(params, args, exprs) {
  let updated = null
  for (let i = 0; i < exprs.length; i++) {
    let cur = exprs[i], inst = instantiateArgs(params, args, cur)
    if (cur != inst && !updated) updated = exprs.slice(0, i)
    if (updated) updated.push(inst)
  }
  return updated || exprs
}

let instantiateArgs = exports.instantiateArgs = function(params, args, expr) {
  if (expr.type == "RuleIdentifier") {
    let pos = params.indexOf(expr.id.name)
    if (pos > -1) {
      if (expr.arguments.length) throw new Error("Arguments to params not supported yet")
      return args[pos]
    }
    let newArgs = instantiateArray(params, args, expr.arguments)
    return newArgs == expr.arguments ? expr : build(expr.type, expr, {id: expr.id, arguments: newArgs})
  } else if (expr.type == "RepeatedMatch" || expr.type == "LookaheadMatch") {
    let inst = instantiateArgs(params, args, expr.expr)
    return inst != expr.expr ? build(expr.type, expr, {expr: inst, kind: expr.kind}) : expr
  } else if (expr.type == "SequenceMatch" || expr.type == "ChoiceMatch") {
    let updated = instantiateArray(params, args, expr.exprs)
    return updated != expr.exprs ? build(expr.type, expr, {exprs: updated}) : expr
  } else {
    return expr
  }
}

function forEachExpr(expr, f) {
  if (f(expr) === false) return
  if (expr.type == "RepeatedMatch" || expr.type == "LookaheadMatch")
    forEachExpr(expr.expr, f)
  else if (expr.type == "SequenceMatch" || expr.type == "ChoiceMatch")
    for (let i = 0; i < expr.exprs.length; i++) forEachExpr(expr.exprs[i], f)
  else if (expr.type == "RuleIdentifier")
    for (let i = 0; i < expr.arguments.length; i++) forEachExpr(expr.arguments[i], f)
}



/* FIXME Delay this until scopes are easier to access
exports.canBeNull = function(expr, rules, args) {
  if (expr.type == "RepeatedMatch") {
    return expr.kind == "+" ? canBeNull(expr.expr, rules) : true
  } else if (expr.type == "LookaheadMatch" || expr.type == "Label" || expr.type == "PredicateMatch") {
    return true
  } else if (expr.type == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      if (!canBeNull(expr.exprs[i], rules)) return false
    return true
  } else if (expr.type == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      if (canBeNull(expr.exprs[i], rules)) return true
    return false
  } else if (expr.type == "RuleIdentifier") {
    if
    return rules[expr.id.name].canBeNull(rules)
  } else {
    return false
  }
}

function checkExpr(expr, rules) {
  forEachExpr(expr, expr => {
    if (expr.type == "RepeatMatch" && expr.kind != "?" && canBeNull(expr.expr, rules))
      throw new Error(`Expressions that don't make progress (can match the empty string) can't have '${expr.kind}' applied to them`)
    else if (expr.type == "RuleIdentifier" && !(expr.id.name in rules))
      throw new Error(`Reference to undefined rule '${expr.id.name}'`)
    else if (expr.type == "SuperMatch")
      throw new Error("'super' in invalid position")
  })
}
*/
