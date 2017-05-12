with(space) {
  Expr { (num | var | ParenExpr) (op Expr)? }
  ParenExpr* { '(' Expr ')' }
}
tokens {
  num { '0'-'9'+ } = "number"
  var { 'a'-'z'+ } = "variable"
  op { '+' | '-' | '/' | '*' }
}
space { (' ' | '\t' | '\n')* }
