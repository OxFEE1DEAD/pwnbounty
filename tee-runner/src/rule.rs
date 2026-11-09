use crate::{
    protocol::{account, amount},
    Result,
};

pub enum Rule {
    Or(Box<Rule>, Box<Rule>),
    And(Box<Rule>, Box<Rule>),
    Not(Box<Rule>),
    In(Vec<String>),
    Cmp(Var, Op, u128),
}

#[derive(Clone, Copy)]
pub enum Var {
    Amount,
    Total,
    Payments,
    Balance,
    RecipientTotal,
}

#[derive(Clone, Copy)]
pub enum Op {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

pub struct State<'a> {
    pub recipient: &'a str,
    pub amount: u128,
    pub total: u128,
    pub payments: u128,
    pub balance: u128,
    pub recipient_total: u128,
}

impl Rule {
    pub fn parse(text: &str) -> Result<Self> {
        if text.len() > 4096 {
            return Err("Invalid rule".into());
        }
        let mut parser = Parser {
            tokens: tokens(text)?,
            at: 0,
            depth: 0,
        };
        let rule = parser.or()?;
        if parser.at != parser.tokens.len() {
            return Err("Invalid rule".into());
        }
        Ok(rule)
    }

    pub fn allows(&self, state: &State) -> bool {
        match self {
            Rule::Or(a, b) => a.allows(state) || b.allows(state),
            Rule::And(a, b) => a.allows(state) && b.allows(state),
            Rule::Not(a) => !a.allows(state),
            Rule::In(set) => set.iter().any(|pattern| {
                pattern
                    .strip_prefix('*')
                    .map_or(pattern == state.recipient, |suffix| {
                        state.recipient.ends_with(suffix)
                    })
            }),
            Rule::Cmp(var, op, n) => {
                let value = match var {
                    Var::Amount => state.amount,
                    Var::Total => state.total,
                    Var::Payments => state.payments,
                    Var::Balance => state.balance,
                    Var::RecipientTotal => state.recipient_total,
                };
                match op {
                    Op::Eq => value == *n,
                    Op::Ne => value != *n,
                    Op::Lt => value < *n,
                    Op::Le => value <= *n,
                    Op::Gt => value > *n,
                    Op::Ge => value >= *n,
                }
            }
        }
    }
}

fn tokens(text: &str) -> Result<Vec<String>> {
    let word = |c: char| c.is_ascii_alphanumeric() || "_.*-".contains(c);
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            c if c.is_whitespace() => {}
            '(' | ')' | '{' | '}' | ',' => out.push(c.to_string()),
            '=' => {
                chars.next_if_eq(&'=');
                out.push("=".into());
            }
            '<' | '>' | '!' => match chars.next_if_eq(&'=') {
                Some(_) => out.push(format!("{c}=")),
                None if c != '!' => out.push(c.to_string()),
                None => return Err("Invalid rule".into()),
            },
            '≤' => out.push("<=".into()),
            '≥' => out.push(">=".into()),
            '≠' => out.push("!=".into()),
            c if word(c) => {
                let mut token = c.to_string();
                while let Some(next) = chars.next_if(|&n| word(n)) {
                    token.push(next);
                }
                out.push(token);
            }
            _ => return Err("Invalid rule".into()),
        }
    }
    if out.is_empty() || out.len() > 1024 {
        return Err("Invalid rule".into());
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<String>,
    at: usize,
    depth: u8,
}

impl Parser {
    fn next(&mut self) -> Result<String> {
        let token = self.tokens.get(self.at).cloned().ok_or("Invalid rule")?;
        self.at += 1;
        Ok(token)
    }
    fn eat(&mut self, word: &str) -> bool {
        let hit = self
            .tokens
            .get(self.at)
            .is_some_and(|t| t.eq_ignore_ascii_case(word));
        self.at += hit as usize;
        hit
    }
    fn expect(&mut self, word: &str) -> Result<()> {
        self.eat(word).then_some(()).ok_or("Invalid rule".into())
    }
    fn or(&mut self) -> Result<Rule> {
        let mut rule = self.and()?;
        while self.eat("or") {
            rule = Rule::Or(Box::new(rule), Box::new(self.and()?));
        }
        Ok(rule)
    }
    fn and(&mut self) -> Result<Rule> {
        let mut rule = self.unary()?;
        while self.eat("and") {
            rule = Rule::And(Box::new(rule), Box::new(self.unary()?));
        }
        Ok(rule)
    }
    fn unary(&mut self) -> Result<Rule> {
        self.depth += 1;
        if self.depth > 32 {
            return Err("Invalid rule".into());
        }
        let rule = if self.eat("not") {
            Rule::Not(Box::new(self.unary()?))
        } else if self.eat("(") {
            let rule = self.or()?;
            self.expect(")")?;
            rule
        } else {
            self.condition()?
        };
        self.depth -= 1;
        Ok(rule)
    }
    fn condition(&mut self) -> Result<Rule> {
        let name = self.next()?.to_ascii_lowercase();
        if name == "recipient" {
            let negate = self.eat("not");
            let rule = if self.eat("in") {
                self.expect("{")?;
                let mut set = vec![self.pattern()?];
                while self.eat(",") {
                    set.push(self.pattern()?);
                }
                self.expect("}")?;
                if set.len() > 256 {
                    return Err("Invalid rule".into());
                }
                Rule::In(set)
            } else if negate {
                return Err("Invalid rule".into());
            } else {
                match self.next()?.as_str() {
                    "=" => Rule::In(vec![self.pattern()?]),
                    "!=" => Rule::Not(Box::new(Rule::In(vec![self.pattern()?]))),
                    _ => return Err("Invalid rule".into()),
                }
            };
            return Ok(if negate {
                Rule::Not(Box::new(rule))
            } else {
                rule
            });
        }
        let var = match name.as_str() {
            "amount" => Var::Amount,
            "total" => Var::Total,
            "payments" => Var::Payments,
            "balance" => Var::Balance,
            "recipient_total" => Var::RecipientTotal,
            _ => return Err("Invalid rule".into()),
        };
        let op = match self.next()?.as_str() {
            "=" => Op::Eq,
            "!=" => Op::Ne,
            "<" => Op::Lt,
            "<=" => Op::Le,
            ">" => Op::Gt,
            ">=" => Op::Ge,
            _ => return Err("Invalid rule".into()),
        };
        Ok(Rule::Cmp(var, op, amount(&self.next()?)?))
    }
    fn pattern(&mut self) -> Result<String> {
        let pattern = self.next()?;
        account(pattern.strip_prefix("*.").unwrap_or(&pattern))?;
        Ok(pattern)
    }
}
