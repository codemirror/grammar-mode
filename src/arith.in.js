grammar arith {
  rules {
    Expr { num | var | Expr op Expr | '(' Expr ')' }
  }
  tokens {
    num { '0'-'9'+ }
    var { 'a'-'z'+ }
  }
  helpers {
    op { '+' | '-' | '/' | '*' }
  }
}
