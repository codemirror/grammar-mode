grammar arith {
  with(space) {
    Expr { (num | var | ParenExpr) (op Expr)? }
    ParenExpr* { '(' Expr ')' }
  }
  tokens {
    num="number" { '0'-'9'+ }
    var="variable" { 'a'-'z'+ }
    op { '+' | '-' | '/' | '*' }
  }
  space { (' ' | '\t' | '\n')* }
}
